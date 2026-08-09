import { z } from "zod";

export const paymentIntentCreateSchema = z.strictObject({
  planVersionId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
});

export const paymentIntentIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^pay_[a-f0-9]{32}$/);
