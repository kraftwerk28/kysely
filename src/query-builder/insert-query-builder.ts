import { OperationNodeSource } from '../operation-node/operation-node-source.js'
import { CompiledQuery } from '../query-compiler/compiled-query.js'
import {
  parseSelectArg,
  parseSelectAll,
  SelectExpression,
  SelectArg,
} from '../parser/select-parser.js'
import {
  InsertExpression,
  InsertObjectOrList,
  InsertObjectOrListFactory,
  parseInsertExpression,
} from '../parser/insert-values-parser.js'
import { InsertQueryNode } from '../operation-node/insert-query-node.js'
import { QueryNode } from '../operation-node/query-node.js'
import {
  MergePartial,
  SimplifyResult,
  SimplifySingleResult,
} from '../util/type-utils.js'
import {
  UpdateExpression,
  parseUpdateExpression,
} from '../parser/update-set-parser.js'
import { preventAwait } from '../util/prevent-await.js'
import { Compilable } from '../util/compilable.js'
import { QueryExecutor } from '../query-executor/query-executor.js'
import { QueryId } from '../util/query-id.js'
import { freeze } from '../util/object-utils.js'
import { OnDuplicateKeyNode } from '../operation-node/on-duplicate-key-node.js'
import { InsertResult } from './insert-result.js'
import { KyselyPlugin } from '../plugin/kysely-plugin.js'
import { ReturningRow } from '../parser/returning-parser.js'
import {
  isNoResultErrorConstructor,
  NoResultError,
  NoResultErrorConstructor,
} from './no-result-error.js'
import {
  ExpressionOrFactory,
  parseExpression,
} from '../parser/expression-parser.js'
import { ColumnNode } from '../operation-node/column-node.js'
import { ReturningInterface } from './returning-interface.js'
import {
  OnConflictBuilder,
  OnConflictDoNothingBuilder,
  OnConflictUpdateBuilder,
} from './on-conflict-builder.js'
import { OnConflictNode } from '../operation-node/on-conflict-node.js'
import { Selectable } from '../util/column-type.js'
import { Explainable, ExplainFormat } from '../util/explainable.js'
import { Expression } from '../expression/expression.js'
import { KyselyTypeError } from '../util/type-error.js'
import { Streamable } from '../util/streamable.js'

export class InsertQueryBuilder<DB, TB extends keyof DB, O>
  implements
    ReturningInterface<DB, TB, O>,
    OperationNodeSource,
    Compilable<O>,
    Explainable,
    Streamable<O>
{
  readonly #props: InsertQueryBuilderProps

  constructor(props: InsertQueryBuilderProps) {
    this.#props = freeze(props)
  }

  /**
   * Sets the values to insert for an {@link Kysely.insertInto | insert} query.
   *
   * This method takes an object whose keys are column names and values are
   * values to insert. In addition to the column's type, the values can be
   * raw {@link sql} snippets or select queries.
   *
   * You must provide all fields you haven't explicitly marked as nullable
   * or optional using {@link Generated} or {@link ColumnType}.
   *
   * The return value of an `insert` query is an instance of {@link InsertResult}. The
   * {@link InsertResult.insertId | insertId} field holds the auto incremented primary
   * key if the database returned one.
   *
   * On PostgreSQL and some other dialects, you need to call `returning` to get
   * something out of the query.
   *
   * Also see the {@link expression} method for inserting the result of a select
   * query or any other expression.
   *
   * ### Examples
   *
   * Insert a row into `person`:
   * ```ts
   * const result = await db
   *   .insertInto('person')
   *   .values({
   *     first_name: 'Jennifer',
   *     last_name: 'Aniston'
   *   })
   *   .executeTakeFirstOrThrow()
   * ```
   *
   * The generated SQL (PostgreSQL):
   *
   * ```sql
   * insert into "person" ("first_name", "last_name") values ($1, $2)
   * ```
   *
   * On dialects that support it (for example PostgreSQL) you can insert multiple
   * rows by providing an array. Note that the return value is once again very
   * dialect-specific. Some databases may only return the id of the *last* inserted
   * row and some return nothing at all unless you call `returning`.
   *
   * ```ts
   * await db
   *   .insertInto('person')
   *   .values([{
   *     first_name: 'Jennifer',
   *     last_name: 'Aniston'
   *   }, {
   *     first_name: 'Arnold',
   *     last_name: 'Schwarzenegger',
   *   }])
   *   .execute()
   * ```
   *
   * The generated SQL (PostgreSQL):
   *
   * ```sql
   * insert into "person" ("first_name", "last_name") values (($1, $2), ($3, $4))
   * ```
   *
   * On PostgreSQL you need to chain `returning` to the query to get
   * the inserted row's columns (or any other expression) as the
   * return value:
   *
   * ```ts
   * const row = await db
   *   .insertInto('person')
   *   .values({
   *     first_name: 'Jennifer',
   *     last_name: 'Aniston'
   *   })
   *   .returning('id')
   *   .executeTakeFirstOrThrow()
   *
   * row.id
   * ```
   *
   * The generated SQL (PostgreSQL):
   *
   * ```sql
   * insert into "person" ("first_name", "last_name") values ($1, $2) returning "id"
   * ```
   *
   * In addition to primitives, the values can also be raw sql expressions or
   * select queries:
   *
   * ```ts
   * import { sql } from 'kysely'
   *
   * const result = await db
   *   .insertInto('person')
   *   .values((eb) => ({
   *     first_name: 'Jennifer',
   *     last_name: sql`${'Ani'} || ${'ston'}`,
   *     middle_name: eb.ref('first_name'),
   *     age: eb.selectFrom('person').select(sql`avg(age)`),
   *   }))
   *   .executeTakeFirst()
   *
   * console.log(result.insertId)
   * ```
   *
   * The generated SQL (PostgreSQL):
   *
   * ```sql
   * insert into "person" ("first_name", "last_name", "age")
   * values ($1, $2 || $3, (select avg(age) from "person"))
   * ```
   *
   * You can also use the callback version of subqueries or raw expressions:
   *
   * ```ts
   * db.with('jennifer', (db) => db
   *   .selectFrom('person')
   *   .where('first_name', '=', 'Jennifer')
   *   .select(['id', 'first_name', 'gender'])
   *   .limit(1)
   * ).insertInto('pet').values((eb) => ({
   *   owner_id: eb.selectFrom('jennifer').select('id'),
   *   name: eb.selectFrom('jennifer').select('first_name'),
   *   species: 'cat',
   * }))
   * ```
   */
  values(insert: InsertObjectOrList<DB, TB>): InsertQueryBuilder<DB, TB, O>

  values(
    insert: InsertObjectOrListFactory<DB, TB>
  ): InsertQueryBuilder<DB, TB, O>

  values(insert: InsertExpression<DB, TB>): InsertQueryBuilder<DB, TB, O> {
    const [columns, values] = parseInsertExpression(insert)

    return new InsertQueryBuilder({
      ...this.#props,
      queryNode: InsertQueryNode.cloneWith(this.#props.queryNode, {
        columns,
        values,
      }),
    })
  }

  /**
   * Sets the columns to insert.
   *
   * The {@link values} method sets both the columns and the values and this method
   * is not needed. But if you are using the {@link expression} method, you can use
   * this method to set the columns to insert.
   *
   * ### Examples
   *
   * ```ts
   * db.insertInto('person')
   *   .columns(['first_name'])
   *   .expression((eb) => eb.selectFrom('pet').select('pet.name'))
   * ```
   *
   * The generated SQL (PostgreSQL):
   *
   * ```sql
   * insert into "person" ("first_name")
   * select "pet"."name" from "pet"
   * ```
   */
  columns(
    columns: ReadonlyArray<keyof DB[TB] & string>
  ): InsertQueryBuilder<DB, TB, O> {
    return new InsertQueryBuilder({
      ...this.#props,
      queryNode: InsertQueryNode.cloneWith(this.#props.queryNode, {
        columns: freeze(columns.map(ColumnNode.create)),
      }),
    })
  }

  /**
   * Insert an arbitrary expression. For example the result of a select query.
   *
   * ### Examples
   *
   * ```ts
   * db.insertInto('person')
   *   .columns(['first_name'])
   *   .expression((eb) => eb.selectFrom('pet').select('pet.name'))
   * ```
   *
   * The generated SQL (PostgreSQL):
   *
   * ```sql
   * insert into "person" ("first_name")
   * select "pet"."name" from "pet"
   * ```
   */
  expression(
    expression: ExpressionOrFactory<DB, TB, any>
  ): InsertQueryBuilder<DB, TB, O> {
    return new InsertQueryBuilder({
      ...this.#props,
      queryNode: InsertQueryNode.cloneWith(this.#props.queryNode, {
        values: parseExpression(expression),
      }),
    })
  }

  /**
   * Changes an `insert into` query to an `insert ignore into` query.
   *
   * If you use the ignore modifier, ignorable errors that occur while executing the
   * insert statement are ignored. For example, without ignore, a row that duplicates
   * an existing unique index or primary key value in the table causes a duplicate-key
   * error and the statement is aborted. With ignore, the row is discarded and no error
   * occurs.
   *
   * This is only supported on some dialects like MySQL. On most dialects you should
   * use the {@link onConflict} method.
   *
   * ### Examples
   *
   * ```ts
   * await db.insertInto('person')
   *   .ignore()
   *   .values(values)
   *   .execute()
   * ```
   */
  ignore(): InsertQueryBuilder<DB, TB, O> {
    return new InsertQueryBuilder({
      ...this.#props,
      queryNode: InsertQueryNode.cloneWith(this.#props.queryNode, {
        ignore: true,
      }),
    })
  }

  /**
   * Adds an `on conflict` clause to the query.
   *
   * `on conflict` is only supported by some dialects like PostgreSQL and SQLite. On MySQL
   * you can use {@link ignore} and {@link onDuplicateKeyUpdate} to achieve similar results.
   *
   * ### Examples
   *
   * ```ts
   * await db
   *   .insertInto('pet')
   *   .values({
   *     name: 'Catto',
   *     species: 'cat',
   *   })
   *   .onConflict((oc) => oc
   *     .column('name')
   *     .doUpdateSet({ species: 'hamster' })
   *   )
   *   .execute()
   * ```
   *
   * The generated SQL (PostgreSQL):
   *
   * ```sql
   * insert into "pet" ("name", "species")
   * values ($1, $2)
   * on conflict ("name")
   * do update set "species" = $3
   * ```
   *
   * You can provide the name of the constraint instead of a column name:
   *
   * ```ts
   * await db
   *   .insertInto('pet')
   *   .values({
   *     name: 'Catto',
   *     species: 'cat',
   *   })
   *   .onConflict((oc) => oc
   *     .constraint('pet_name_key')
   *     .doUpdateSet({ species: 'hamster' })
   *   )
   *   .execute()
   * ```
   *
   * The generated SQL (PostgreSQL):
   *
   * ```sql
   * insert into "pet" ("name", "species")
   * values ($1, $2)
   * on conflict on constraint "pet_name_key"
   * do update set "species" = $3
   * ```
   *
   * You can also specify an expression as the conflict target in case
   * the unique index is an expression index:
   *
   * ```ts
   * import { sql } from 'kysely'
   *
   * await db
   *   .insertInto('pet')
   *   .values({
   *     name: 'Catto',
   *     species: 'cat',
   *   })
   *   .onConflict((oc) => oc
   *     .expression(sql`lower(name)`)
   *     .doUpdateSet({ species: 'hamster' })
   *   )
   *   .execute()
   * ```
   *
   * The generated SQL (PostgreSQL):
   *
   * ```sql
   * insert into "pet" ("name", "species")
   * values ($1, $2)
   * on conflict (lower(name))
   * do update set "species" = $3
   * ```
   *
   * You can add a filter for the update statement like this:
   *
   * ```ts
   * await db
   *   .insertInto('pet')
   *   .values({
   *     name: 'Catto',
   *     species: 'cat',
   *   })
   *   .onConflict((oc) => oc
   *     .column('name')
   *     .doUpdateSet({ species: 'hamster' })
   *     .where('excluded.name', '!=', 'Catto'')
   *   )
   *   .execute()
   * ```
   *
   * The generated SQL (PostgreSQL):
   *
   * ```sql
   * insert into "pet" ("name", "species")
   * values ($1, $2)
   * on conflict ("name")
   * do update set "species" = $3
   * where "excluded"."name" != $4
   * ```
   *
   * You can create an `on conflict do nothing` clauses like this:
   *
   * ```ts
   * await db
   *   .insertInto('pet')
   *   .values({
   *     name: 'Catto',
   *     species: 'cat',
   *   })
   *   .onConflict((oc) => oc
   *     .column('name')
   *     .doNothing()
   *   )
   *   .execute()
   * ```
   *
   * The generated SQL (PostgreSQL):
   *
   * ```sql
   * insert into "pet" ("name", "species")
   * values ($1, $2)
   * on conflict ("name") do nothing
   * ```
   *
   * You can refer to the columns of the virtual `excluded` table
   * in a type-safe way using a callback and the `ref` method of
   * `ExpressionBuilder`:
   *
   * ```ts
   * db.insertInto('person')
   *   .values(person)
   *   .onConflict(oc => oc
   *     .column('id')
   *     .doUpdateSet({
   *       first_name: (eb) => eb.ref('excluded.first_name'),
   *       last_name: (eb) => eb.ref('excluded.last_name')
   *     })
   *   )
   * ```
   */
  onConflict(
    callback: (
      builder: OnConflictBuilder<DB, TB>
    ) => OnConflictDoNothingBuilder<DB, TB> | OnConflictUpdateBuilder<DB, TB>
  ): InsertQueryBuilder<DB, TB, O> {
    return new InsertQueryBuilder({
      ...this.#props,
      queryNode: InsertQueryNode.cloneWith(this.#props.queryNode, {
        onConflict: callback(
          new OnConflictBuilder({
            onConflictNode: OnConflictNode.create(),
          })
        ).toOperationNode(),
      }),
    })
  }

  /**
   * Adds `on duplicate key update` to the query.
   *
   * If you specify `on duplicate key update`, and a row is inserted that would cause
   * a duplicate value in a unique index or primary key, an update of the old row occurs.
   *
   * This is only implemented by some dialects like MySQL. On most dialects you should
   * use {@link onConflict} instead.
   *
   * ### Examples
   *
   * ```ts
   * await db
   *   .insertInto('person')
   *   .values(values)
   *   .onDuplicateKeyUpdate({ species: 'hamster' })
   * ```
   */
  onDuplicateKeyUpdate(
    update: UpdateExpression<DB, TB, TB>
  ): InsertQueryBuilder<DB, TB, O> {
    return new InsertQueryBuilder({
      ...this.#props,
      queryNode: InsertQueryNode.cloneWith(this.#props.queryNode, {
        onDuplicateKey: OnDuplicateKeyNode.create(
          parseUpdateExpression(update)
        ),
      }),
    })
  }

  returning<SE extends SelectExpression<DB, TB>>(
    selection: SelectArg<DB, TB, SE>
  ): InsertQueryBuilder<DB, TB, ReturningRow<DB, TB, O, SE>> {
    return new InsertQueryBuilder({
      ...this.#props,
      queryNode: QueryNode.cloneWithReturning(
        this.#props.queryNode,
        parseSelectArg(selection)
      ),
    })
  }

  returningAll(): InsertQueryBuilder<DB, TB, Selectable<DB[TB]>> {
    return new InsertQueryBuilder({
      ...this.#props,
      queryNode: QueryNode.cloneWithReturning(
        this.#props.queryNode,
        parseSelectAll()
      ),
    })
  }

  /**
   * Simply calls the provided function passing `this` as the only argument. `$call` returns
   * what the provided function returns.
   *
   * If you want to conditionally call a method on `this`, see
   * the {@link $if} method.
   *
   * ### Examples
   *
   * The next example uses a helper function `log` to log a query:
   *
   * ```ts
   * function log<T extends Compilable>(qb: T): T {
   *   console.log(qb.compile())
   *   return qb
   * }
   *
   * db.updateTable('person')
   *   .set(values)
   *   .$call(log)
   *   .execute()
   * ```
   */
  $call<T>(func: (qb: this) => T): T {
    return func(this)
  }

  /**
   * @deprecated Use `$call` instead
   */
  call<T>(func: (qb: this) => T): T {
    return this.$call(func)
  }

  /**
   * Call `func(this)` if `condition` is true.
   *
   * This method is especially handy with optional selects. Any `returning` or `returningAll`
   * method calls add columns as optional fields to the output type when called inside
   * the `func` callback. This is because we can't know if those selections were actually
   * made before running the code.
   *
   * You can also call any other methods inside the callback.
   *
   * ### Examples
   *
   * ```ts
   * async function insertPerson(values: InsertablePerson, returnLastName: boolean) {
   *   return await db
   *     .insertInto('person')
   *     .values(values)
   *     .returning(['id', 'first_name'])
   *     .$if(returnLastName, (qb) => qb.returning('last_name'))
   *     .executeTakeFirstOrThrow()
   * }
   * ```
   *
   * Any selections added inside the `if` callback will be added as optional fields to the
   * output type since we can't know if the selections were actually made before running
   * the code. In the example above the return type of the `insertPerson` function is:
   *
   * ```ts
   * {
   *   id: number
   *   first_name: string
   *   last_name?: string
   * }
   * ```
   */
  $if<O2>(
    condition: boolean,
    func: (qb: this) => InsertQueryBuilder<DB, TB, O2>
  ): InsertQueryBuilder<
    DB,
    TB,
    O2 extends InsertResult
      ? InsertResult
      : O extends InsertResult
      ? Partial<O2>
      : MergePartial<O, O2>
  > {
    if (condition) {
      return func(this) as any
    }

    return new InsertQueryBuilder({
      ...this.#props,
    })
  }

  /**
   * @deprecated Use `$if` instead
   */
  if<O2>(
    condition: boolean,
    func: (qb: this) => InsertQueryBuilder<DB, TB, O2>
  ): InsertQueryBuilder<
    DB,
    TB,
    O2 extends InsertResult
      ? InsertResult
      : O extends InsertResult
      ? Partial<O2>
      : MergePartial<O, O2>
  > {
    return this.$if(condition, func)
  }

  /**
   * Change the output type of the query.
   *
   * You should only use this method as the last resort if the types
   * don't support your use case.
   */
  $castTo<T>(): InsertQueryBuilder<DB, TB, T> {
    return new InsertQueryBuilder(this.#props)
  }

  /**
   * @deprecated Use `$castTo` instead.
   */
  castTo<T>(): InsertQueryBuilder<DB, TB, T> {
    return this.$castTo<T>()
  }

  /**
   * Asserts that query's output row type equals the given type `T`.
   *
   * This method can be used to simplify excessively complex types to make typescript happy
   * and much faster.
   *
   * Kysely uses complex type magic to achieve its type safety. This complexity is sometimes too much
   * for typescript and you get errors like this:
   *
   * ```
   * error TS2589: Type instantiation is excessively deep and possibly infinite.
   * ```
   *
   * In these case you can often use this method to help typescript a little bit. When you use this
   * method to assert the output type of a query, Kysely can drop the complex output type that
   * consists of multiple nested helper types and replace it with the simple asserted type.
   *
   * Using this method doesn't reduce type safety at all. You have to pass in a type that is
   * structurally equal to the current type.
   *
   * ### Examples
   *
   * ```ts
   * const result = await db
   *   .with('new_person', (qb) => qb
   *     .insertInto('person')
   *     .values(person)
   *     .returning('id')
   *     .$assertType<{ id: string }>()
   *   )
   *   .with('new_pet', (qb) => qb
   *     .insertInto('pet')
   *     .values((eb) => ({ owner_id: eb.selectFrom('new_person').select('id'), ...pet }))
   *     .returning(['name as pet_name', 'species'])
   *     .$assertType<{ pet_name: string, species: Species }>()
   *   )
   *   .selectFrom(['new_person', 'new_pet'])
   *   .selectAll()
   *   .executeTakeFirstOrThrow()
   * ```
   */
  $assertType<T extends O>(): O extends T
    ? InsertQueryBuilder<DB, TB, T>
    : KyselyTypeError<`$assertType() call failed: The type passed in is not equal to the output type of the query.`> {
    return new InsertQueryBuilder(this.#props) as unknown as any
  }

  /**
   * @deprecated Use `$assertType` instead.
   */
  assertType<T extends O>(): O extends T
    ? InsertQueryBuilder<DB, TB, T>
    : KyselyTypeError<`assertType() call failed: The type passed in is not equal to the output type of the query.`> {
    return new InsertQueryBuilder(this.#props) as unknown as any
  }

  /**
   * Returns a copy of this InsertQueryBuilder instance with the given plugin installed.
   */
  withPlugin(plugin: KyselyPlugin): InsertQueryBuilder<DB, TB, O> {
    return new InsertQueryBuilder({
      ...this.#props,
      executor: this.#props.executor.withPlugin(plugin),
    })
  }

  toOperationNode(): InsertQueryNode {
    return this.#props.executor.transformQuery(
      this.#props.queryNode,
      this.#props.queryId
    )
  }

  compile(): CompiledQuery<O> {
    return this.#props.executor.compileQuery(
      this.toOperationNode(),
      this.#props.queryId
    )
  }

  /**
   * Executes the query and returns an array of rows.
   *
   * Also see the {@link executeTakeFirst} and {@link executeTakeFirstOrThrow} methods.
   */
  async execute(): Promise<SimplifyResult<O>[]> {
    const compiledQuery = this.compile()
    const query = compiledQuery.query as InsertQueryNode

    const result = await this.#props.executor.executeQuery<O>(
      compiledQuery,
      this.#props.queryId
    )

    if (this.#props.executor.adapter.supportsReturning && query.returning) {
      return result.rows as any
    }

    return [
      new InsertResult(
        result.insertId,
        // TODO: remove numUpdatedOrDeletedRows.
        result.numAffectedRows ?? result.numUpdatedOrDeletedRows
      ) as any,
    ]
  }

  /**
   * Executes the query and returns the first result or undefined if
   * the query returned no result.
   */
  async executeTakeFirst(): Promise<SimplifySingleResult<O>> {
    const [result] = await this.execute()
    return result as SimplifySingleResult<O>
  }

  /**
   * Executes the query and returns the first result or throws if
   * the query returned no result.
   *
   * By default an instance of {@link NoResultError} is thrown, but you can
   * provide a custom error class, or callback as the only argument to throw a different
   * error.
   */
  async executeTakeFirstOrThrow(
    errorConstructor:
      | NoResultErrorConstructor
      | ((node: QueryNode) => Error) = NoResultError
  ): Promise<SimplifyResult<O>> {
    const result = await this.executeTakeFirst()

    if (result === undefined) {
      const error = isNoResultErrorConstructor(errorConstructor)
        ? new errorConstructor(this.toOperationNode())
        : errorConstructor(this.toOperationNode())

      throw error
    }

    return result as SimplifyResult<O>
  }

  async *stream(chunkSize: number = 100): AsyncIterableIterator<O> {
    const compiledQuery = this.compile()

    const stream = this.#props.executor.stream<O>(
      compiledQuery,
      chunkSize,
      this.#props.queryId
    )

    for await (const item of stream) {
      yield* item.rows
    }
  }

  async explain<ER extends Record<string, any> = Record<string, any>>(
    format?: ExplainFormat,
    options?: Expression<any>
  ): Promise<ER[]> {
    const builder = new InsertQueryBuilder<DB, TB, ER>({
      ...this.#props,
      queryNode: QueryNode.cloneWithExplain(
        this.#props.queryNode,
        format,
        options
      ),
    })

    return await builder.execute()
  }
}

preventAwait(
  InsertQueryBuilder,
  "don't await InsertQueryBuilder instances directly. To execute the query you need to call `execute` or `executeTakeFirst`."
)

export interface InsertQueryBuilderProps {
  readonly queryId: QueryId
  readonly queryNode: InsertQueryNode
  readonly executor: QueryExecutor
}
