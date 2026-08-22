import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'

interface PercentRingProps {
  percent: number
  size?: number
}

export function PercentRing({ percent, size = 96 }: PercentRingProps) {
  const clamped = Math.max(0, Math.min(percent, 100))
  const data = [
    { name: 'filled', value: clamped },
    { name: 'remaining', value: 100 - clamped }
  ]

  return (
    <div className="relative shrink-0" style={{ height: size, width: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius="72%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive={false}
          >
            <Cell fill="#34d399" />
            <Cell fill="#181c26" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-semibold text-text">{Math.round(clamped)}%</span>
      </div>
    </div>
  )
}
