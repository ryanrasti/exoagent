import type { Caps } from '../../main'

export default async ({ browser, log }: Caps) => {
  await browser.navigate({ url: 'https://www.google.com' })
  log('Navigated to Google')

  await browser.type({ selector: 'textarea[name="q"]', text: 'exoagent github' })
  log('Typed search query')

  await browser.press({ key: 'Enter' })
  log('Pressed Enter')

  const title = await browser.title()
  log(`Page title: ${title}`)
}
