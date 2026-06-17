type AnalyticsEvent = {
  Records: { Sns: { Message: string } }[];
};

export async function handler(event: AnalyticsEvent) {
  for (const record of event.Records) {
    const order = JSON.parse(record.Sns.Message);
    console.log(`Analytics: recording order ${order.id}, total=$${order.total}, items=${order.items.length}`);
  }

  return { recorded: event.Records.length };
}
