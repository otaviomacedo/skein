type PaymentEvent = {
  id: string;
  total: number;
  customer: { email: string };
};

export async function handler(event: PaymentEvent) {
  // Simulate payment processing
  const chargeId = `ch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  console.log(`Charging ${event.total} for order ${event.id}`);

  if (event.total > 10000) {
    return { ...event, paymentStatus: "REQUIRES_REVIEW", chargeId };
  }

  return { ...event, paymentStatus: "CHARGED", chargeId };
}

