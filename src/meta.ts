import type { ToolProps } from './policy'

const policyMetadataKey = Symbol('policyMetadata')
type PolicyMetadata = {
  [key: string]: ToolProps<string[], string[]>
}

export const getPolicyMetadata = (target: object): PolicyMetadata | null => {
  if (typeof target === 'object' && target !== null) {
    return (target as any)[policyMetadataKey]
  }
  return null
}

export const setPolicyMetadata = (obj: object, metadata: PolicyMetadata): void => {
  if (typeof obj !== 'object' || obj === null) {
    throw new Error(`Target is not an object`)
  }
  (obj as any)[policyMetadataKey] = metadata
}
