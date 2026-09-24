/** The one place that reads the environment: everything else takes its settings from here. */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  currency: process.env.CURRENCY ?? 'EUR',
}
