import { Alarm, AlarmProps, mkAlarm, getAlarmAtt } from "../generated/cloudwatch.js";
import { Topic, getTopicAtt } from "../generated/sns.js";
import { updateResource } from "../runtime/registry.js";
import { box } from "../runtime/box.js";

export interface AlarmOnMetricProps {
  namespace: string;
  metricName: string;
  dimensions?: Array<{ name: string; value: string }>;
  statistic?: string;
  period?: number;
  threshold: number;
  comparisonOperator: string;
  evaluationPeriods?: number;
}

export const alarmOnMetric = box(
  "alarmOnMetric",
  (logicalId: string, props: AlarmOnMetricProps): Alarm => {
    return mkAlarm(logicalId, {
      namespace: props.namespace,
      metricName: props.metricName,
      dimensions: props.dimensions,
      statistic: props.statistic ?? "Sum",
      period: props.period ?? 300,
      threshold: props.threshold,
      comparisonOperator: props.comparisonOperator,
      evaluationPeriods: props.evaluationPeriods ?? 1,
    });
  },
);

export const notifyOnAlarm = box(
  "notifyOnAlarm",
  (alarm: Alarm, topic: Topic): [Alarm, Topic] => {
    const existingActions = alarm.properties.alarmActions as string[] ?? [];
    const properties = {
      ...alarm.properties,
      alarmActions: [...existingActions, getTopicAtt(topic, "TopicArn")],
    };
    updateResource(alarm.logicalId, alarm.__type, properties);
    return [{ ...alarm, properties } as Alarm, topic];
  },
);
