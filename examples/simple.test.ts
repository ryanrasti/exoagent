import { describe, expect, it } from 'vitest'
import { chat } from './simple'
import { createMockModel, getToolResults } from './test-utils'

describe('simple example e2e', () => {
  it('lists todos for user', async () => {
    const model = createMockModel([
      {
        code: `async ({ currentUser }) => {
          return await currentUser
            .join(({ user }) => user.todos())
            .select(({ todo }) => ({ title: todo.title, completed: todo.completed }))
            .execute()
        }`,
      },
    ])

    const result = await chat('list my todos', model)
    const toolResults = getToolResults(result)

    // Assert exact structure with SQL
    expect(toolResults).toEqual([{
      results: [
        { title: 'Buy groceries', completed: 0 },
        { title: 'Walk the dog', completed: 1 },
        { title: 'Finish report', completed: 0 },
      ],
      sql: 'SELECT "todo"."title" as "title", "todo"."completed" as "completed" FROM "users" AS "user" JOIN "todos" AS "todo" ON "todo"."user_id" = "user"."id" WHERE "user"."id" = ?',
      parameters: [1],
    }])
  })

  it('filters incomplete todos', async () => {
    const model = createMockModel([
      {
        code: `async ({ currentUser }) => {
          return await currentUser
            .join(({ user }) => user.todos())
            .select(({ todo }) => ({ title: todo.title, completed: todo.completed }))
            .where(({ todo }) => todo.completed['='](0))
            .execute()
        }`,
      },
    ])

    const result = await chat('show incomplete todos', model)
    const toolResults = getToolResults(result)

    // Assert exact structure with SQL
    expect(toolResults).toEqual([{
      results: [
        { title: 'Buy groceries', completed: 0 },
        { title: 'Finish report', completed: 0 },
      ],
      sql: 'SELECT "todo"."title" as "title", "todo"."completed" as "completed" FROM "users" AS "user" JOIN "todos" AS "todo" ON "todo"."user_id" = "user"."id" WHERE "todo"."completed" = ? AND "user"."id" = ?',
      parameters: [0, 1],
    }])
  })

  it('enforces capability-based access - user 1 cannot see user 2 todos', async () => {
    const model = createMockModel([
      {
        code: `async ({ currentUser }) => {
          return await currentUser
            .join(({ user }) => user.todos())
            .select(({ user, todo }) => ({ userName: user.name, title: todo.title }))
            .execute()
        }`,
      },
    ])

    const result = await chat('list all todos', model, 1)
    const toolResults = getToolResults(result)

    // Assert exact structure with SQL - User 1 (Alice) should only see her own todos
    expect(toolResults).toEqual([{
      results: [
        { userName: 'Alice', title: 'Buy groceries' },
        { userName: 'Alice', title: 'Walk the dog' },
        { userName: 'Alice', title: 'Finish report' },
      ],
      sql: 'SELECT "user"."name" as "userName", "todo"."title" as "title" FROM "users" AS "user" JOIN "todos" AS "todo" ON "todo"."user_id" = "user"."id" WHERE "user"."id" = ?',
      parameters: [1],
    }])
  })
})
