import { Daemon } from './daemon'
import { resolve } from 'node:path'

async function main() {
  const repoDir = resolve(process.argv[2] ?? '.')
  console.log('Starting daemon...')
  const daemon = await Daemon.start({ repoDir, agentId: 'smoke-test' })
  console.log('Daemon started')

  console.log('Initializing session...')
  try {
    const session = await daemon.pi.init()
    console.log('Session ready, model:', session.model?.id)
    console.log('Sending prompt...')
    const response = await daemon.pi.prompt('Say "hello world" and nothing else.')
    console.log('Response:', response)
  }
  catch (err: any) {
    console.error('Error during session/prompt:', err.message)
    console.error('Stack:', err.stack?.split('\n').slice(0, 5).join('\n'))
  }

  await daemon.stop()
  console.log('Done')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
