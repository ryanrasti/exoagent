import { describe, expect, it } from 'vitest'
import { chat } from './saas-bot'
import { createMockModel, getToolResults } from './test-utils'

describe('saas-bot example e2e', () => {
  it('lists projects for organization', async () => {
    const model = createMockModel([
      {
        code: `async ({ organization }) => {
          return await organization()
            .join(({ org }) => org.projects())
            .select(({ project }) => ({ name: project.name, status: project.status }))
            .execute()
        }`,
      },
    ])

    const result = await chat('list projects', model)
    const toolResults = getToolResults(result)

    // Assert exact structure with SQL
    expect(toolResults).toEqual([{
      results: [
        { name: 'Website Redesign', status: 'active' },
        { name: 'Mobile App', status: 'active' },
        { name: 'API v2', status: 'planning' },
      ],
      sql: 'SELECT "project"."name" as "name", "project"."status" as "status" FROM "organizations" AS "org" JOIN "projects" AS "project" ON "project"."org_id" = "org"."id" WHERE "org"."id" = ?',
      parameters: [1],
    }])
  })

  it('navigates org -> project -> task hierarchy', async () => {
    const model = createMockModel([
      {
        code: `async ({ organization }) => {
          return await organization()
            .join(({ org }) => org.projects())
            .join(({ project }) => project.tasks())
            .select(({ project, task }) => ({
              project: project.name,
              task: task.title,
              status: task.status
            }))
            .execute()
        }`,
      },
    ])

    const result = await chat('show all tasks', model)
    const toolResults = getToolResults(result)

    // Assert exact structure with SQL - Acme Corp has 6 tasks across 3 projects
    expect(toolResults).toEqual([{
      results: [
        { project: 'Website Redesign', task: 'Design homepage mockup', status: 'in_progress' },
        { project: 'Website Redesign', task: 'Implement responsive nav', status: 'todo' },
        { project: 'Website Redesign', task: 'Set up CI/CD', status: 'done' },
        { project: 'Mobile App', task: 'User authentication', status: 'in_progress' },
        { project: 'Mobile App', task: 'Push notifications', status: 'todo' },
        { project: 'API v2', task: 'API design review', status: 'todo' },
      ],
      sql: 'SELECT "project"."name" as "project", "task"."title" as "task", "task"."status" as "status" FROM "organizations" AS "org" JOIN "projects" AS "project" ON "project"."org_id" = "org"."id" JOIN "tasks" AS "task" ON "task"."project_id" = "project"."id" WHERE "org"."id" = ?',
      parameters: [1],
    }])
  })

  it('gets task comments', async () => {
    const model = createMockModel([
      {
        code: `async ({ organization }) => {
          return await organization()
            .join(({ org }) => org.projects())
            .join(({ project }) => project.tasks())
            .join(({ task }) => task.comments())
            .select(({ task, comment }) => ({
              task: task.title,
              comment: comment.content
            }))
            .execute()
        }`,
      },
    ])

    const result = await chat('show comments', model)
    const toolResults = getToolResults(result)

    // Assert exact structure with SQL
    expect(toolResults).toEqual([{
      results: [
        { task: 'Design homepage mockup', comment: 'Looking great so far! Can we add more contrast?' },
        { task: 'Design homepage mockup', comment: 'Good point, I will adjust the colors.' },
        { task: 'User authentication', comment: 'Should we support social login too?' },
        { task: 'User authentication', comment: 'Yes, please add Google and GitHub OAuth.' },
      ],
      sql: 'SELECT "task"."title" as "task", "comment"."content" as "comment" FROM "organizations" AS "org" JOIN "projects" AS "project" ON "project"."org_id" = "org"."id" JOIN "tasks" AS "task" ON "task"."project_id" = "project"."id" JOIN "comments" AS "comment" ON "comment"."task_id" = "task"."id" WHERE "org"."id" = ?',
      parameters: [1],
    }])
  })

  it('lists team members', async () => {
    const model = createMockModel([
      {
        code: `async ({ organization }) => {
          return await organization()
            .join(({ org }) => org.members())
            .select(({ member }) => ({ name: member.name, role: member.role }))
            .execute()
        }`,
      },
    ])

    const result = await chat('list team members', model)
    const toolResults = getToolResults(result)

    // Assert exact structure with SQL
    expect(toolResults).toEqual([{
      results: [
        { name: 'Alice Admin', role: 'admin' },
        { name: 'Bob Builder', role: 'member' },
        { name: 'Carol Coder', role: 'member' },
      ],
      sql: 'SELECT "member"."name" as "name", "member"."role" as "role" FROM "organizations" AS "org" JOIN "users" AS "member" ON "member"."org_id" = "org"."id" WHERE "org"."id" = ?',
      parameters: [1],
    }])
  })

  it('filters tasks by status', async () => {
    const model = createMockModel([
      {
        code: `async ({ organization }) => {
          return await organization()
            .join(({ org }) => org.projects())
            .join(({ project }) => project.tasks())
            .select(({ task }) => ({ title: task.title, status: task.status, priority: task.priority }))
            .where(({ task }) => task.status['=']('in_progress'))
            .execute()
        }`,
      },
    ])

    const result = await chat('show in progress tasks', model)
    const toolResults = getToolResults(result)

    // Assert exact structure with SQL
    expect(toolResults).toEqual([{
      results: [
        { title: 'Design homepage mockup', status: 'in_progress', priority: 'high' },
        { title: 'User authentication', status: 'in_progress', priority: 'high' },
      ],
      sql: 'SELECT "task"."title" as "title", "task"."status" as "status", "task"."priority" as "priority" FROM "organizations" AS "org" JOIN "projects" AS "project" ON "project"."org_id" = "org"."id" JOIN "tasks" AS "task" ON "task"."project_id" = "project"."id" WHERE "task"."status" = ? AND "org"."id" = ?',
      parameters: ['in_progress', 1],
    }])
  })
})
