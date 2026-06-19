import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

const sfn = new SFNClient({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

type SQSEvent = {
  Records: { body: string; messageId: string }[];
};

export async function handler(event: SQSEvent) {
  for (const record of event.Records) {
    const order = JSON.parse(record.body);

    await sfn.send(new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      name: `order-${order.id}`,
      input: record.body,
    }));

    console.log(`Started fulfillment for order ${order.id}`);
  }

  return { processed: event.Records.length };
}
