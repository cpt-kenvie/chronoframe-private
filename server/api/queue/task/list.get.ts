import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'

// 队列页面默认每页任务数量，控制轮询请求体积。
const DEFAULT_PAGE_SIZE = 50
// 限制单页上限，避免分页接口被当作全量导出使用。
const MAX_PAGE_SIZE = 200

const querySchema = z.object({
  status: z.enum(['pending', 'in-stages', 'completed', 'failed']).optional(),
  type: z
    .enum([
      'photo',
      'video',
      'live-photo-video',
      'photo-reverse-geocoding',
      'file-encryption',
    ])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
})

/** 获取分页队列任务，并单独返回全局状态统计。 */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const { status, type, page, pageSize } = await getValidatedQuery(
    event,
    querySchema.parse,
  )
  const db = useDB()
  const conditions: SQL[] = []

  if (status) conditions.push(eq(tables.pipelineQueue.status, status))
  if (type) {
    conditions.push(
      eq(sql`json_extract(${tables.pipelineQueue.payload}, '$.type')`, type),
    )
  }

  const whereCondition =
    conditions.length > 0 ? and(...conditions) : undefined
  const tasks = db
    .select({
      id: tables.pipelineQueue.id,
      payload: tables.pipelineQueue.payload,
      priority: tables.pipelineQueue.priority,
      attempts: tables.pipelineQueue.attempts,
      maxAttempts: tables.pipelineQueue.maxAttempts,
      status: tables.pipelineQueue.status,
      statusStage: tables.pipelineQueue.statusStage,
      errorMessage: tables.pipelineQueue.errorMessage,
      createdAt: tables.pipelineQueue.createdAt,
      completedAt: tables.pipelineQueue.completedAt,
    })
    .from(tables.pipelineQueue)
    .where(whereCondition)
    .orderBy(
      desc(tables.pipelineQueue.createdAt),
      desc(tables.pipelineQueue.id),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  const totalResult = db
    .select({ count: sql<number>`count(*)` })
    .from(tables.pipelineQueue)
    .where(whereCondition)
    .get()
  const statusRows = db
    .select({
      status: tables.pipelineQueue.status,
      count: sql<number>`count(*)`,
    })
    .from(tables.pipelineQueue)
    .groupBy(tables.pipelineQueue.status)
    .all()

  const stats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  }
  for (const row of statusRows) {
    if (row.status === 'pending') stats.pending = row.count
    else if (row.status === 'in-stages') stats.processing = row.count
    else if (row.status === 'completed') stats.completed = row.count
    else if (row.status === 'failed') stats.failed = row.count
  }

  const total = totalResult?.count ?? 0
  return {
    success: true,
    data: tasks,
    stats,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  }
})
