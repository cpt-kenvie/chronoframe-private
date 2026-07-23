import { eq } from 'drizzle-orm'
import { z } from 'zod'

/**
 * 删除单个非执行中的队列任务。
 */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)

  const { taskId } = await getValidatedRouterParams(
    event,
    z.object({
      taskId: z
        .string()
        .regex(/^[1-9]\d*$/)
        .transform(value => Number.parseInt(value, 10)),
    }).parse,
  )

  const db = useDB()

  db.transaction((tx) => {
    const task = tx
      .select({ status: tables.pipelineQueue.status })
      .from(tables.pipelineQueue)
      .where(eq(tables.pipelineQueue.id, taskId))
      .get()

    if (!task) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Task not found',
      })
    }

    if (task.status === 'in-stages') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Cannot delete a running task',
      })
    }

    tx.delete(tables.pipelineQueue)
      .where(eq(tables.pipelineQueue.id, taskId))
      .run()
  })

  return {
    success: true,
    taskId,
  }
})
