export default async ({ storage }: { storage: { get: (key: string) => Promise<string>, set: (key: string, value: string) => Promise<void> } }) => {
  const greeting = 'hello world'
  const upper = greeting.toUpperCase()
  await storage.set('greeting', upper)
  const result = await storage.get('greeting')
  return result
}
