# Support tickets and chat

All registered, active users can open tickets. Public API and vendor API reads are restricted to the authenticated user's own tickets. Platform support staff use the admin API; vendor staff do not receive access to other users' tickets.

Apply `prisma/migrations/20260924120000_support_ticket_chat/migration.sql` through the project's normal Prisma migration deployment before running this version. It adds assignment and internal-note fields, indexes conversation history, and normalizes legacy categories, priorities and statuses. Existing closed tickets become resolved and can be reopened.

## User API

Base path: `/v1/api`. Existing `/v1/api/vendor` support paths provide the same owner-scoped behavior. Requests use the existing session cookie. Mutations also require the session's `X-CSRF-Token`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/support-tickets/create` | Create ticket and opening message |
| GET | `/support-tickets` | List own tickets |
| GET | `/support-tickets/:ticketId` | Ticket and first page of messages |
| GET | `/support-tickets/:ticketId/messages` | Read/poll messages |
| PATCH | `/support-tickets/:ticketId/reply` | Send message or attachment |
| PATCH | `/support-tickets/:ticketId` | Resolve or reopen own ticket |

Create example:

```json
{
    "subject": "Payment completed but order is pending",
    "category": "payment",
    "priority": "high",
    "message": "Please help me check my order."
}
```

Categories: `general` (default), `account`, `order`, `booking`, `payment`, `technical`.
Priorities: `low`, `medium` (default), `high`.
Statuses: `open`, `in_progress`, `waiting_on_user`, `resolved`.

Lists accept `offset`, `limit` (maximum 100), `status`, `priority`, `category`, `assigned_to`, and `search` (subject or ticket number). The response's `result` contains `rows`, `total`, `offset`, and `limit`.

Messages accept `after` (last received message ID, initially 0) and `limit` (default 50, maximum 100). The response's `result` contains `rows`, `next_cursor`, and `has_more`. Continue fetching while `has_more` is true, then periodically poll using `next_cursor`. Merge messages by ID to avoid duplicates. Ticket detail returns the same cursor metadata with messages in `replies`.

Replies take `message`, `attachment`, or both. Text is trimmed and limited to 5,000 characters. An attachment is a PNG/JPEG/PDF base64 data URL, limited to 5 MiB decoded, with a matching file signature. Uploads use the existing S3 service and storage configuration. Failed database writes trigger upload cleanup.

Users can PATCH `{ "status": "resolved" }` or `{ "status": "open" }`. A public user reply automatically reopens the ticket. Staff public replies move it to `waiting_on_user`.

## Staff API

Base path: `/v1/api/admin`. The same paths apply, plus `GET /support-tickets/agents` for eligible assignee user IDs and names. The legacy `/support-tickets/view/:ticketId` detail path remains available.

The admin router requires an active platform administrator. All support routes require `support.can_read`; replies and updates additionally require `support.can_update`; creation requires `support.can_create`. Super administrators retain the existing permission bypass.

Staff can filter all tickets and PATCH `status`, `priority`, or `assigned_to` (a user ID, or null to unassign). Assignees must be active platform staff with current support read/update permissions, or active super administrators.

Private notes use the reply endpoint with `is_internal: true`. They are returned only through the staff API, excluded from user reply counts/history, do not change public activity/status, and do not notify users. Messages are append-only.

## Notifications

In-app notifications are written in the same transaction as public ticket changes. New tickets alert eligible support agents; user replies alert the eligible assignee, falling back to the support team. Staff public replies alert the owner. Assignment alerts the new assignee. Notifications contain ticket references, not message bodies or notes.

All authenticated users can use `/v1/api/notifications`, `/notifications/unread-count`, `/notifications/:notificationId`, `/notifications/:notificationId/read`, and `/notifications/mark-all-read`. Reads and updates remain scoped to the caller.

This backend supports asynchronous chat through polling. Live presence, typing indicators, email notifications, and a frontend are not part of this implementation.

## Verification

Run `node --test test/support.test.js` for validation, ownership, note privacy, rollback, notifications, and status behavior. Run `node --test test/support-database.test.js` with `SUPPORT_DATABASE_URL` set to a disposable PostgreSQL database for migration and query integration checks; the test creates and removes its own isolated schema. Run `npm.cmd test` on Windows for the full suite.
