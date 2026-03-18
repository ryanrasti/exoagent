import { Daemon } from './daemon'
import { spawnAgent } from './spawn'
import { resolve } from 'node:path'

async function main() {
  const repoDir = resolve(process.argv[2] ?? '.')
  console.log('Starting daemon...')
  const daemon = await Daemon.start({ repoDir })

  console.log('Spawning agent...')
  const agent = await spawnAgent({
    id: 'smoke-test',
    repoDir,
    dataDir: daemon.dataDir,
    storage: daemon.storage,
    forgejo: daemon.forgejo,
  })
  console.log('Agent spawned:', agent.id)

  console.log('Initializing session...')
  try {
    const session = await agent.pi.init()
    console.log('Session ready, model:', session.model?.id)
    console.log('Sending prompt...')
    const response = await agent.pi.prompt('Say "hello world" and nothing else.')
    console.log('Response:', response)
  }
  catch (err: any) {
    console.error('Error:', err.message)
    console.error('Stack:', err.stack?.split('\n').slice(0, 5).join('\n'))
  }

  agent.pi.dispose()
  await daemon.stop()
  console.log('Done')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
