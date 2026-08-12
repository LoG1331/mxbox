import { cn } from '../lib/format.js'
import { EmptyState } from './ui.jsx'

export default function DataTable({
  columns,
  rows,
  rowKey = 'id',
  emptyTitle = 'No data',
  emptyDescription = 'Try changing the filters or create a new entry.',
  onRowClick,
  selectedKey,
  className,
}) {
  if (!rows.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className={cn('overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl', className)}>
      <div className="grid gap-3 p-3 md:hidden">
        {rows.map((row, index) => {
          const key = typeof rowKey === 'function' ? rowKey(row) : row[rowKey]
          const isSelected = selectedKey !== undefined && selectedKey === key

          return (
            <article
              key={key ?? index}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'rounded-xl border border-white/10 bg-white/5 p-4 transition-all duration-300',
                onRowClick ? 'cursor-pointer hover:bg-white/10' : '',
                isSelected ? 'border-[#38bdf8]/30 bg-[#38bdf8]/10' : '',
              )}
            >
              <div className="space-y-3">
                {columns.map((column) => (
                  <div key={column.key} className="grid gap-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
                      {column.label}
                    </p>
                    <div className="text-sm text-white">
                      {column.render ? column.render(row) : row[column.key]}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          )
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b border-white/5 bg-white/5">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    'px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-400',
                    column.headerClassName,
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const key = typeof rowKey === 'function' ? rowKey(row) : row[rowKey]
              const isSelected = selectedKey !== undefined && selectedKey === key

              return (
                <tr
                  key={key ?? index}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-white/5 transition-colors last:border-none',
                    onRowClick ? 'cursor-pointer hover:bg-white/5' : '',
                    isSelected ? 'bg-[#38bdf8]/10' : '',
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn('px-4 py-3 align-top text-sm text-gray-200', column.cellClassName)}
                    >
                      {column.render ? column.render(row) : row[column.key]}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
