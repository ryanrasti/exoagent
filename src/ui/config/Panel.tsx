import type { ConfigFieldSchema, ConfigProviderImpl } from '../../providers/config'
import { useEffect, useState } from 'react'
import { exoRpc } from '../lib/exoRpc'

type ConfigCaps = { config: ConfigProviderImpl }
type Schemas = { [scope: string]: { [key: string]: ConfigFieldSchema } }
type Values = { [scope: string]: { [key: string]: string } }

export default function ConfigPanel() {
	const [schemas, setSchemas] = useState<Schemas>({})
	const [values, setValues] = useState<Values>({})
	const [error, setError] = useState<string | null>(null)
	const [visibleSecrets, setVisibleSecrets] = useState<{ [key: string]: boolean }>({})

	const load = async () => {
		try {
			const s = (await exoRpc<ConfigCaps>(({ config }) => config.getSchemas())) as Schemas
			const v = (await exoRpc<ConfigCaps>(({ config }) => config.getAllConfig())) as Values
			setSchemas(s)
			setValues(v)
			setError(null)
		}
		catch (e) {
			setError(String(e))
		}
	}

	useEffect(() => {
		load()
	}, [])

	const handleSave = async (scope: string, key: string, val: string) => {
		try {
			await exoRpc<ConfigCaps>(
				({ config }) => config.setGlobal(scope, key, val),
				{ scope, key, val },
			)
			await load()
		}
		catch (e) {
			setError(String(e))
		}
	}

	return (
		<div className="max-w-[800px] mx-auto my-8 px-4 font-sans text-gray-200">
			<div className="flex items-center gap-3 mb-6">
				<a href={`http://localhost:${window.location.port}/`} className="text-gray-500 hover:text-gray-300 transition-colors">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
				</a>
				<h1 className="text-xl m-0 font-bold text-gray-100">config provider</h1>
			</div>

			{error && <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-3 rounded mb-6">{error}</div>}

			<div className="flex flex-col gap-6">
				{Object.keys(schemas).length === 0 && (
					<div className="text-gray-500 italic bg-neutral-800 border border-neutral-700 rounded-lg p-5">
						No clients have registered schemas yet.
					</div>
				)}
				{Object.entries(schemas).map(([scope, schema]) => (
					<div
						key={scope}
						className="bg-neutral-800 border border-neutral-700 rounded-lg p-5"
					>
						<h2 className="text-lg font-semibold text-gray-100 mb-4 pb-2 border-b border-neutral-700">{scope}</h2>

						<div className="space-y-4">
							{Object.entries(schema).map(([key, field]) => {
								const val = values[scope]?.[key] || ''
								return (
									<div key={key} className="flex flex-col gap-1.5">
										<div className="flex items-baseline gap-2">
											<label className="text-sm font-medium text-gray-300">
												{key}
												{field.isRequired && <span className="text-red-400 ml-1">*</span>}
											</label>
											<span className="text-xs text-gray-500 bg-neutral-900 px-1.5 py-0.5 rounded font-mono">
												{field.type}
											</span>
										</div>
										{field.description && (
											<div
												className="text-xs text-gray-400 mb-1"
												dangerouslySetInnerHTML={{
													__html: field.description.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-blue-400 hover:text-blue-300 underline">$1</a>'),
												}}
											/>
										)}
										<form
											onSubmit={(e) => {
												e.preventDefault()
												const formData = new FormData(e.currentTarget)
												handleSave(scope, key, formData.get('val') as string)
											}}
											className="flex gap-2 w-full"
										>
											<div className="relative flex-1">
												<input
													name="val"
													type={field.isSecret && !visibleSecrets[`${scope}:${key}`] ? 'password' : 'text'}
													defaultValue={val}
													placeholder={`Enter ${key}`}
													className="w-full px-3 py-2 pr-10 bg-neutral-900 text-gray-200 border border-neutral-600 rounded focus:border-blue-500 focus:outline-none font-mono text-sm"
												/>
												{field.isSecret && (
													<button
														type="button"
														className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 cursor-pointer bg-transparent border-none p-1 flex items-center justify-center"
														onClick={() => setVisibleSecrets(prev => ({ ...prev, [`${scope}:${key}`]: !prev[`${scope}:${key}`] }))}
														title={visibleSecrets[`${scope}:${key}`] ? 'Hide' : 'Show'}
													>
														{visibleSecrets[`${scope}:${key}`]
															? (
																<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
																	<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
																	<line x1="1" y1="1" x2="23" y2="23" />
																</svg>
															)
															: (
																<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
																	<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
																	<circle cx="12" cy="12" r="3" />
																</svg>
															)}
													</button>
												)}
											</div>
											<button
												type="submit"
												className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded font-medium transition-colors border border-neutral-600 cursor-pointer text-sm whitespace-nowrap"
											>
												save
											</button>
										</form>
									</div>
								)
							})}
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
