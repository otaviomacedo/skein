import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const sns = new SNSClient({});
const TOPIC_ARN = process.env.TOPIC_ARN!;

type FulfilledEvent = {
  id: string;
  items: { sku: string; quantity: number; price: number }[];
  customer: { email: string; address: string };
  total: number;
  chargeId: string;
};

export async function handler(event: FulfilledEvent) {
  await sns.send(new PublishCommand({
    TopicArn: TOPIC_ARN,
    Message: JSON.stringify(event),
    Subject: `Order ${event.id} fulfilled`,
  }));

  return { ...event, notified: true };
}
