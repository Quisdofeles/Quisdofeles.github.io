import type { CSSProperties } from 'react'

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties

export function TitleBar() {
  return <div className="h-9 shrink-0 bg-bg" style={dragStyle} />
}
