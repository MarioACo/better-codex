---
name: migrate
description: Change a database schema safely with the project's migration tool — generate the migration, read its SQL, keep existing data safe, make it reversible and test it up and down on a local database. Use for new tables or columns, renames, indexes and data migrations.
---

# Migrate

1. **Know the tool and the state**: find the migration tool (Prisma, Drizzle, Alembic, Django, Rails, Laravel, Flyway, Knex, TypeORM, EF Core…) and where migrations live, then read the current schema and the last few migrations. Never edit a migration that may have run anywhere: add a new one.
2. **Plan for the data already there** (expand, migrate, contract): add columns nullable or with a default; backfill in batches; add NOT NULL and constraints afterwards; do a rename as add, copy, switch reads, drop, over separate releases. Build indexes without locking where the database allows it (`CREATE INDEX CONCURRENTLY` on Postgres). Say which step locks or rewrites a big table.
3. **Generate it with the tool** (`prisma migrate dev --create-only`, `drizzle-kit generate`, `alembic revision --autogenerate`, `python manage.py makemigrations`, `rails g migration`, `php artisan make:migration`) and **read the SQL it wrote**: generators drop and recreate more often than expected.
4. **Make it reversible**: a down or rollback that works, or say why it can't be one (data loss).
5. **Test locally only**: apply, roll back, apply again on the local or test database (a compose service, SQLite), then run the app's tests. Never point it at a shared, staging or production database.
6. **Report**: the migration file, what it changes, what locks or risks it carries, how to roll it back, and the exact command to apply it elsewhere, for the user to run.
