import { getDistributionAtt } from "../generated/cloudfront.js";
import type { Distribution, CloudFrontOriginAccessIdentity as OAI } from "../generated/cloudfront.js";
import type { Certificate } from "../generated/certificatemanager.js";
import { getBucketAtt } from "../generated/s3.js";
import type { Bucket } from "../generated/s3.js";
import { updateResource } from "../runtime/registry.js";
import { ref, getAtt, fnJoin, deriveId, makeResource } from "../runtime/resource.js";
import type { Resource } from "../runtime/resource.js";
import { box } from "../runtime/box.js";

export interface Route53RecordProps {
  hostedZoneName?: string;
  name: string;
  type: string;
  aliasTarget?: {
    dnsName: string;
    hostedZoneId: string;
  };
}

export type Route53Record = Resource<"AWS::Route53::RecordSet"> & {
  properties: Route53RecordProps;
};

export const setOrigin = box(
  "setOrigin",
  (dist: Distribution, bucket: Bucket, oai: OAI): [Distribution, Bucket, OAI] => {
    const originId = `S3-${bucket.logicalId}`;
    const oaiPath = fnJoin("", ["origin-access-identity/cloudfront/", ref(oai)]);

    const properties: Distribution["properties"] = {
      ...dist.properties,
      distributionConfig: {
        ...dist.properties.distributionConfig,
        origins: [{
          id: originId,
          domainName: getBucketAtt(bucket, "DomainName"),
          s3OriginConfig: { originAccessIdentity: oaiPath },
        }],
        defaultCacheBehavior: {
          targetOriginId: originId,
          viewerProtocolPolicy: "redirect-to-https",
          forwardedValues: { queryString: false },
        },
      },
    };
    updateResource(dist.logicalId, dist.__type, properties);
    return [{ ...dist, properties }, bucket, oai];
  },
);

export const enableAccessLogging = box(
  "enableAccessLogging",
  (dist: Distribution, logBucket: Bucket): [Distribution, Bucket] => {
    const properties: Distribution["properties"] = {
      ...dist.properties,
      distributionConfig: {
        ...dist.properties.distributionConfig,
        logging: {
          bucket: getBucketAtt(logBucket, "DomainName"),
          prefix: "cdn-logs/",
        },
      },
    };
    updateResource(dist.logicalId, dist.__type, properties);
    return [{ ...dist, properties }, logBucket];
  },
);

export const attachCert = box(
  "attachCert",
  (dist: Distribution, cert: Certificate): [Distribution, Certificate] => {
    const properties: Distribution["properties"] = {
      ...dist.properties,
      distributionConfig: {
        ...dist.properties.distributionConfig,
        viewerCertificate: {
          acmCertificateArn: ref(cert),
          sslSupportMethod: "sni-only",
        },
      },
    };
    updateResource(dist.logicalId, dist.__type, properties);
    return [{ ...dist, properties }, cert];
  },
);

export const addAliasRecord = box(
  "addAliasRecord",
  (dist: Distribution, config: { hostedZone: string; recordName?: string }): [Distribution, Route53Record] => {
    const recordName = config.recordName ?? config.hostedZone;
    const record = makeResource("AWS::Route53::RecordSet", deriveId(dist, "AliasRecord"), {
      hostedZoneName: `${config.hostedZone}.`,
      name: recordName,
      type: "A",
      aliasTarget: {
        dnsName: getDistributionAtt(dist, "DomainName"),
        hostedZoneId: "Z2FDTNDATAQYW2",
      },
    }) as Route53Record;
    return [dist, record];
  },
);
