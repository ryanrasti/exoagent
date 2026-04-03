/**
 * Review provider UI entry point.
 * Renders the ReviewApp or Picker based on state.
 */

import { useState, useEffect } from 'react'
import { Picker } from './ui/Picker'
import { ReviewApp } from './ui/ReviewApp'
import { exoRpc } from './ui/rpc'
import type { ReviewProviderImpl } from './index'

type ReviewCaps = { review: ReviewProviderImpl }

export default function ReviewPanel() {
	const [reviewId, setReviewId] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		// Check for existing reviews
		exoRpc<ReviewCaps>(({ review }) => review.list())
			.then((reviews: any[]) => {
				if (reviews.length > 0) {
					setReviewId(reviews[0].id)
				}
				setLoading(false)
			})
			.catch(() => setLoading(false))
	}, [])

	if (loading) {
		return <div style={{ padding: 20 }}>Loading...</div>
	}

	if (!reviewId) {
		return <Picker onCreated={(id) => setReviewId(id)} />
	}

	return <ReviewApp reviewId={reviewId} onBack={() => setReviewId(null)} />
}
