import { mkCluster, mkService, mkTaskDefinition } from "../generated/ecs.js";
import type { Cluster, Service, TaskDefinition } from "../generated/ecs.js";
import { mkLoadBalancer, mkTargetGroup, mkListener } from "../generated/elasticloadbalancingv2.js";
import type { LoadBalancer, TargetGroup, Listener } from "../generated/elasticloadbalancingv2.js";
import { mkSecurityGroup } from "../generated/ec2.js";
import type { SecurityGroup, Subnet, VPC } from "../generated/ec2.js";
import { mkLogGroup } from "../generated/logs.js";
import type { LogGroup } from "../generated/logs.js";
import { mkRole } from "../generated/iam.js";
import type { Role } from "../generated/iam.js";
import { ref } from "../runtime/resource.js";
import { addDependency } from "../runtime/registry.js";
import { box } from "../runtime/box.js";

// === Mid-level boxes ===

/**
 * Creates an ECS task execution role with the standard permissions for pulling
 * images and writing logs.
 */
export const taskExecutionRole = box(
  "taskExecutionRole",
  (logicalId: string): Role => {
    return mkRole(logicalId, {
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Principal: { Service: "ecs-tasks.amazonaws.com" },
          Action: "sts:AssumeRole",
        }],
      },
      managedPolicyArns: [
        "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
      ] as any,
    });
  },
);

/**
 * Creates an ECS task role (the role the container application assumes at runtime).
 * Starts with no policies — use grant boxes to add permissions.
 */
export const taskRole = box(
  "taskRole",
  (logicalId: string): Role => {
    return mkRole(logicalId, {
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Principal: { Service: "ecs-tasks.amazonaws.com" },
          Action: "sts:AssumeRole",
        }],
      },
    });
  },
);

/**
 * Creates an Application Load Balancer with a security group, target group,
 * and HTTP listener. The ALB is placed in the given subnets.
 */
export const albWithListener = box(
  "albWithListener",
  (logicalId: string, vpcResource: VPC, subnets: readonly Subnet[], port: number): { readonly alb: LoadBalancer; readonly targetGroup: TargetGroup; readonly listener: Listener; readonly securityGroup: SecurityGroup } => {
    const sg = mkSecurityGroup(`${logicalId}ALBSG`, {
      groupDescription: `ALB security group for ${logicalId}`,
      vpcId: vpcResource,
      securityGroupIngress: [{
        ipProtocol: "tcp",
        fromPort: port,
        toPort: port,
        cidrIp: "0.0.0.0/0",
      }],
    });

    const alb = mkLoadBalancer(`${logicalId}ALB`, {
      scheme: "internet-facing",
      type: "application",
      subnets: subnets.map(s => s.subnetId),
      securityGroups: [sg.groupId],
    });

    const targetGroup = mkTargetGroup(`${logicalId}TG`, {
      vpcId: vpcResource,
      port,
      protocol: "HTTP",
      targetType: "ip",
      healthCheckPath: "/",
    });

    const listener = mkListener(`${logicalId}Listener`, {
      loadBalancerArn: alb,
      port,
      protocol: "HTTP",
      defaultActions: [{
        type: "forward",
        targetGroupArn: targetGroup.targetGroupArn,
      }],
    });

    return { alb, targetGroup, listener, securityGroup: sg };
  },
);

// === High-level box ===

export type ContainerProps = {
  image: string;
  port: number;
  cpu?: number;
  memory?: number;
  environment?: Record<string, string>;
};

export type FargateServiceProps = {
  vpc: VPC;
  subnets: readonly Subnet[];
  albSubnets: readonly Subnet[];
  container: ContainerProps;
  desiredCount?: number;
  cpu?: string;
  memory?: string;
  assignPublicIp?: boolean;
};

export type FargateService = {
  readonly cluster: Cluster;
  readonly service: Service;
  readonly taskDefinition: TaskDefinition;
  readonly alb: LoadBalancer;
  readonly targetGroup: TargetGroup;
  readonly listener: Listener;
  readonly securityGroup: SecurityGroup;
  readonly logGroup: LogGroup;
};

/**
 * Creates a Fargate service behind an Application Load Balancer.
 *
 * Produces: ECS Cluster, Task Definition (with execution and task roles, log
 * configuration), Security Group for the tasks, ALB (with its own SG, target group,
 * and HTTP listener), ECS Service wired to the target group, and a CloudWatch Log Group.
 *
 * For custom networking (internal ALB, multiple containers, service discovery),
 * compose mid-level boxes directly: `taskExecutionRole`, `taskRole`, `albWithListener`.
 */
export const fargateService = box(
  "fargateService",
  (logicalId: string, props: FargateServiceProps): FargateService => {
    const {
      vpc: vpcResource,
      subnets,
      albSubnets,
      container,
      desiredCount = 2,
      cpu = "256",
      memory = "512",
      assignPublicIp = false,
    } = props;

    const cluster = mkCluster(`${logicalId}Cluster`, {});

    const execRole = taskExecutionRole(`${logicalId}ExecRole`);
    const appRole = taskRole(`${logicalId}TaskRole`);

    const logGroup = mkLogGroup(`${logicalId}Logs`, {
      retentionInDays: 30,
    });

    const env = container.environment
      ? Object.entries(container.environment).map(([name, value]) => ({ name, value }))
      : undefined;

    const taskDef = mkTaskDefinition(`${logicalId}TaskDef`, {
      family: logicalId,
      cpu,
      memory,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"] as any,
      executionRoleArn: execRole,
      taskRoleArn: appRole.arn,
      containerDefinitions: [{
        name: logicalId,
        image: container.image,
        essential: true,
        portMappings: [{
          containerPort: container.port,
          protocol: "tcp",
        }],
        cpu: container.cpu,
        memory: container.memory,
        environment: env,
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": ref(logGroup),
            "awslogs-region": { Ref: "AWS::Region" },
            "awslogs-stream-prefix": logicalId,
          },
        },
      }] as any,
    });

    const { alb, targetGroup, listener, securityGroup: albSg } = albWithListener(
      logicalId, vpcResource, albSubnets, container.port,
    );

    const taskSg = mkSecurityGroup(`${logicalId}TaskSG`, {
      groupDescription: `Fargate tasks for ${logicalId}`,
      vpcId: vpcResource,
      securityGroupIngress: [{
        ipProtocol: "tcp",
        fromPort: container.port,
        toPort: container.port,
        sourceSecurityGroupId: albSg.groupId,
      }],
    });

    const serviceId = `${logicalId}Service`;
    const service = mkService(serviceId, {
      cluster: cluster.arn,
      taskDefinition: taskDef,
      desiredCount,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: subnets.map(s => s.subnetId),
          securityGroups: [taskSg.groupId],
          assignPublicIp: assignPublicIp ? "ENABLED" : "DISABLED",
        },
      },
      loadBalancers: [{
        containerName: logicalId,
        containerPort: container.port,
        targetGroupArn: targetGroup.targetGroupArn,
      }],
    });

    // Service must wait for the Listener to attach the TG to the ALB
    addDependency(serviceId, listener.logicalId);

    return {
      cluster,
      service,
      taskDefinition: taskDef,
      alb,
      targetGroup,
      listener,
      securityGroup: taskSg,
      logGroup,
    };
  },
);

// === Service auto-scaling ===

import { makeResource, deriveId } from "../runtime/resource.js";
import { updateResource } from "../runtime/registry.js";
import type { Service as EcsService } from "../generated/ecs.js";

export type ServiceScalingConfig = {
  minCapacity: number;
  maxCapacity: number;
  targetCpuUtilization?: number;
  targetMemoryUtilization?: number;
};

/**
 * Adds auto-scaling to an ECS service based on CPU and/or memory utilization.
 * Creates a ScalableTarget and one or two TargetTrackingScalingPolicies.
 */
export const autoScaleService = box(
  "autoScaleService",
  (service: EcsService, cluster: Cluster, config: ServiceScalingConfig): EcsService => {
    const targetId = deriveId(service, "ScaleTarget");
    const resourceId = `service/${ref(cluster)}/${service.name}`;

    makeResource("AWS::ApplicationAutoScaling::ScalableTarget", targetId, {
      serviceNamespace: "ecs",
      resourceId,
      scalableDimension: "ecs:service:DesiredCount",
      minCapacity: config.minCapacity,
      maxCapacity: config.maxCapacity,
    });

    const targetRef = { __type: "AWS::ApplicationAutoScaling::ScalableTarget" as const, logicalId: targetId, properties: {} };

    if (config.targetCpuUtilization) {
      makeResource("AWS::ApplicationAutoScaling::ScalingPolicy", deriveId(service, "CpuScalePolicy"), {
        policyName: deriveId(service, "CpuScalePolicy"),
        policyType: "TargetTrackingScaling",
        scalingTargetId: ref(targetRef),
        targetTrackingScalingPolicyConfiguration: {
          targetValue: config.targetCpuUtilization,
          predefinedMetricSpecification: {
            predefinedMetricType: "ECSServiceAverageCPUUtilization",
          },
        },
      });
    }

    if (config.targetMemoryUtilization) {
      makeResource("AWS::ApplicationAutoScaling::ScalingPolicy", deriveId(service, "MemScalePolicy"), {
        policyName: deriveId(service, "MemScalePolicy"),
        policyType: "TargetTrackingScaling",
        scalingTargetId: ref(targetRef),
        targetTrackingScalingPolicyConfiguration: {
          targetValue: config.targetMemoryUtilization,
          predefinedMetricSpecification: {
            predefinedMetricType: "ECSServiceAverageMemoryUtilization",
          },
        },
      });
    }

    return service;
  },
);

// === Service discovery ===

import { mkPrivateDnsNamespace, mkService as mkCloudMapService } from "../generated/servicediscovery.js";
import type { PrivateDnsNamespace, Service as CloudMapService } from "../generated/servicediscovery.js";
import type { VPC as VPCType } from "../generated/ec2.js";

export type ServiceDiscoveryResult = {
  readonly namespace: PrivateDnsNamespace;
  readonly registryService: CloudMapService;
};

/**
 * Enables service discovery via AWS Cloud Map. Creates a private DNS namespace
 * and a service registry that the ECS service registers into.
 * Other services can then find this service by DNS name (e.g., "api.local").
 */
export const enableServiceDiscovery = box(
  "enableServiceDiscovery",
  (service: EcsService, vpcResource: VPCType, namespaceName: string, serviceName: string): ServiceDiscoveryResult => {
    const namespace = mkPrivateDnsNamespace(deriveId(service, "Namespace"), {
      name: namespaceName,
      vpc: vpcResource.vpcId,
    } as any);

    const registryService = mkCloudMapService(deriveId(service, "Registry"), {
      name: serviceName,
      namespaceId: namespace.id,
      dnsConfig: {
        dnsRecords: [{ type: "A", ttl: 60 }],
      },
      healthCheckCustomConfig: { failureThreshold: 1 },
    } as any);

    // Wire the ECS service to register with Cloud Map
    const serviceProps = service.properties as Record<string, unknown>;
    const existingRegistries = (serviceProps.serviceRegistries as any[]) ?? [];
    const properties = {
      ...serviceProps,
      serviceRegistries: [...existingRegistries, {
        registryArn: registryService.arn,
      }],
    };
    updateResource(service.logicalId, service.__type, properties);

    return { namespace, registryService };
  },
);

// === Sidecar container ===

export type SidecarProps = {
  name: string;
  image: string;
  port?: number;
  essential?: boolean;
  environment?: Record<string, string>;
  command?: string[];
};

/**
 * Adds a sidecar container to an existing task definition.
 * Commonly used for logging agents, proxies, or metrics collectors.
 */
export const addSidecar = box(
  "addSidecar",
  (taskDef: TaskDefinition, sidecar: SidecarProps): TaskDefinition => {
    const props = taskDef.properties as Record<string, unknown>;
    const existingContainers = (props.containerDefinitions as any[]) ?? [];

    const container: Record<string, unknown> = {
      name: sidecar.name,
      image: sidecar.image,
      essential: sidecar.essential ?? false,
    };
    if (sidecar.port) {
      container.portMappings = [{ containerPort: sidecar.port, protocol: "tcp" }];
    }
    if (sidecar.environment) {
      container.environment = Object.entries(sidecar.environment).map(([name, value]) => ({ name, value }));
    }
    if (sidecar.command) {
      container.command = sidecar.command;
    }

    const properties = {
      ...props,
      containerDefinitions: [...existingContainers, container],
    };
    updateResource(taskDef.logicalId, taskDef.__type, properties);
    return { ...taskDef, properties } as TaskDefinition;
  },
);

// === Deployment circuit breaker ===

/**
 * Enables the deployment circuit breaker with automatic rollback on the service.
 * If a deployment fails to stabilize, ECS rolls back to the last stable version.
 */
export const enableCircuitBreaker = box(
  "enableCircuitBreaker",
  (service: EcsService): EcsService => {
    const props = service.properties as Record<string, unknown>;
    const existingDeployConfig = (props.deploymentConfiguration as Record<string, unknown>) ?? {};
    const properties = {
      ...props,
      deploymentConfiguration: {
        ...existingDeployConfig,
        deploymentCircuitBreaker: { enable: true, rollback: true },
      },
    };
    updateResource(service.logicalId, service.__type, properties);
    return { ...service, properties } as EcsService;
  },
);

// === EFS volume mount ===

import type { FileSystem } from "../generated/efs.js";

/**
 * Mounts an EFS filesystem into a container in the task definition.
 * Adds the volume definition and a mount point on the specified container.
 */
export const mountEfs = box(
  "mountEfs",
  (taskDef: TaskDefinition, filesystem: FileSystem, containerName: string, containerPath: string, volumeName?: string): TaskDefinition => {
    const props = taskDef.properties as Record<string, unknown>;
    const existingVolumes = (props.volumes as any[]) ?? [];
    const existingContainers = (props.containerDefinitions as any[]) ?? [];
    const vName = volumeName ?? `efs-${filesystem.logicalId}`;

    // Add volume
    const volumes = [...existingVolumes, {
      name: vName,
      efsVolumeConfiguration: {
        filesystemId: ref(filesystem),
        transitEncryption: "ENABLED",
      },
    }];

    // Add mount point to the target container
    const containerDefinitions = existingContainers.map((c: any) => {
      if (c.name !== containerName) return c;
      const existingMounts = c.mountPoints ?? [];
      return {
        ...c,
        mountPoints: [...existingMounts, { sourceVolume: vName, containerPath, readOnly: false }],
      };
    });

    const properties = { ...props, volumes, containerDefinitions };
    updateResource(taskDef.logicalId, taskDef.__type, properties);
    return { ...taskDef, properties } as TaskDefinition;
  },
);