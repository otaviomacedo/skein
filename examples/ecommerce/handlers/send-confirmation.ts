type ConfirmationEvent = {
  id: string;
  customer: { email: string };
  total: number;
  chargeId: string;
};

export async function handler(event: ConfirmationEvent) {
  console.log(`Sending confirmation to ${event.customer.email} for order ${event.id}`);
  console.log(`Amount: $${event.total}, Charge: ${event.chargeId}`);

  return { ...event, confirmationSent: true, sentAt: new Date().toISOString() };
}

