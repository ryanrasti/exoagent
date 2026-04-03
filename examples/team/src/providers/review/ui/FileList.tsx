/**
 * FileList — sidebar showing files in the review.
 */

import type { ReviewFile } from '../db'

const statusColors: { [key: string]: string } = {
	pending: '#888',
	reviewing: '#4a9eff',
	done: '#4caf50',
}

export const FileList = ({
	files,
	selectedFileId,
	onSelect,
}: {
	files: ReviewFile[]
	selectedFileId: string | null
	onSelect: (fileId: string) => void
}) => {
	return (
		<div style={{ width: 250, borderRight: '1px solid #333', overflow: 'auto' }} data-testid="file-list">
			<div style={{ padding: '12px 16px', fontWeight: 'bold', borderBottom: '1px solid #333' }}>
				Files ({files.length})
			</div>
			{files.map(file => (
				<div
					key={file.id}
					onClick={() => onSelect(file.id)}
					data-testid={`file-item-${file.path}`}
					style={{
						padding: '8px 16px',
						cursor: 'pointer',
						background: selectedFileId === file.id ? '#333' : 'transparent',
						borderBottom: '1px solid #2a2a2a',
						display: 'flex',
						alignItems: 'center',
						gap: 8,
					}}
				>
					<span
						style={{
							width: 8,
							height: 8,
							borderRadius: '50%',
							background: statusColors[file.status] ?? '#888',
							flexShrink: 0,
						}}
						data-testid={`file-status-${file.path}`}
					/>
					<span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
						{file.path}
					</span>
				</div>
			))}
		</div>
	)
}
