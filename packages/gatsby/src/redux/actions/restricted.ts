import { camelCase } from "lodash"
import { GraphQLSchema, GraphQLOutputType } from "graphql"
import { ActionCreator } from "redux"
import { ThunkAction } from "redux-thunk"
import report from "@colin3dmax/gatsby-cli/lib/reporter"
import { parseTypeDef } from "../../schema/types/type-defs"
import {
  GraphQLFieldExtensionDefinition,
  reservedExtensionNames,
} from "../../schema/extensions"
import { GatsbyGraphQLType } from "../../schema/types/type-builders"
import {
  IGatsbyPlugin,
  ActionsUnion,
  IAddThirdPartySchema,
  ICreateTypes,
  IGatsbyState,
  ICreateFieldExtension,
  IPrintTypeDefinitions,
  ICreateResolverContext,
  IGatsbyPluginContext,
} from "../types"

type RestrictionActionNames =
  | "createFieldExtension"
  | "createTypes"
  | "createResolverContext"
  | "addThirdPartySchema"
  | "printTypeDefinitions"

type SomeActionCreator =
  | ActionCreator<ActionsUnion>
  | ActionCreator<ThunkAction<any, IGatsbyState, any, ActionsUnion>>

export const actions = {
  /**
   * Add a third-party schema to be merged into main schema. Schema has to be a
   * graphql-js GraphQLSchema object.
   *
   * This schema is going to be merged as-is. This can easily break the main
   * Gatsby schema, so it's user's responsibility to make sure it doesn't happen
   * (by e.g. namespacing the schema).
   *
   * @availableIn [createSchemaCustomization, sourceNodes]
   *
   * @param {Object} $0
   * @param {GraphQLSchema} $0.schema GraphQL schema to add
   */
  addThirdPartySchema: (
    { schema }: { schema: GraphQLSchema },
    plugin: IGatsbyPlugin,
    traceId?: string
  ): IAddThirdPartySchema => {
    return {
      type: `ADD_THIRD_PARTY_SCHEMA`,
      plugin,
      traceId,
      payload: schema,
    }
  },

  /**
   * Add type definitions to the GraphQL schema.
   *
   * @availableIn [createSchemaCustomization, sourceNodes]
   *
   * @param {string | GraphQLOutputType | GatsbyGraphQLType | string[] | GraphQLOutputType[] | GatsbyGraphQLType[]} types Type definitions
   *
   * Type definitions can be provided either as
   * [`graphql-js` types](https://graphql.org/graphql-js/), in
   * [GraphQL schema definition language (SDL)](https://graphql.org/learn/)
   * or using Gatsby Type Builders available on the `schema` API argument.
   *
   * Things to note:
   * * type definitions targeting node types, i.e. `MarkdownRemark` and others
   *   added in `sourceNodes` or `onCreateNode` APIs, need to implement the
   *   `Node` interface. Interface fields will be added automatically, but it
   *   is mandatory to label those types with `implements Node`.
   * * by default, explicit type definitions from `createTypes` will be merged
   *   with inferred field types, and default field resolvers for `Date` (which
   *   adds formatting options) and `File` (which resolves the field value as
   *   a `relativePath` foreign-key field) are added. This behavior can be
   *   customised with `@infer`, `@dontInfer` directives or extensions. Fields
   *   may be assigned resolver (and other option like args) with additional
   *   directives. Currently `@dateformat`, `@link`, `@fileByRelativePath` and
   *   `@proxy` are available.
   *
   *
   * Schema customization controls:
   * * `@infer` - run inference on the type and add fields that don't exist on the
   * defined type to it.
   * * `@dontInfer` - don't run any inference on the type
   *
   * Extensions to add resolver options:
   * * `@dateformat` - add date formatting arguments. Accepts `formatString` and
   *   `locale` options that sets the defaults for this field
   * * `@link` - connect to a different Node. Arguments `by` and `from`, which
   *   define which field to compare to on a remote node and which field to use on
   *   the source node
   * * `@fileByRelativePath` - connect to a File node. Same arguments. The
   *   difference from link is that this normalizes the relative path to be
   *   relative from the path where source node is found.
   * * `@proxy` - in case the underlying node data contains field names with
   *   characters that are invalid in GraphQL, `proxy` allows to explicitly
   *   proxy those properties to fields with valid field names. Takes a `from` arg.
   *
   *
   * @example
   * exports.createSchemaCustomization = ({ actions }) => {
   *   const { createTypes } = actions
   *   const typeDefs = `
   *     """
   *     Markdown Node
   *     """
   *     type MarkdownRemark implements Node @infer {
   *       frontmatter: Frontmatter!
   *     }
   *
   *     """
   *     Markdown Frontmatter
   *     """
   *     type Frontmatter @infer {
   *       title: String!
   *       author: AuthorJson! @link
   *       date: Date! @dateformat
   *       published: Boolean!
   *       tags: [String!]!
   *     }
   *
   *     """
   *     Author information
   *     """
   *     # Does not include automatically inferred fields
   *     type AuthorJson implements Node @dontInfer {
   *       name: String!
   *       birthday: Date! @dateformat(locale: "ru")
   *     }
   *   `
   *   createTypes(typeDefs)
   * }
   *
   * // using Gatsby Type Builder API
   * exports.createSchemaCustomization = ({ actions, schema }) => {
   *   const { createTypes } = actions
   *   const typeDefs = [
   *     schema.buildObjectType({
   *       name: 'MarkdownRemark',
   *       fields: {
   *         frontmatter: 'Frontmatter!'
   *       },
   *       interfaces: ['Node'],
   *       extensions: {
   *         infer: true,
   *       },
   *     }),
   *     schema.buildObjectType({
   *       name: 'Frontmatter',
   *       fields: {
   *         title: {
   *           type: 'String!',
   *           resolve(parent) {
   *             return parent.title || '(Untitled)'
   *           }
   *         },
   *         author: {
   *           type: 'AuthorJson'
   *           extensions: {
   *             link: {},
   *           },
   *         }
   *         date: {
   *           type: 'Date!'
   *           extensions: {
   *             dateformat: {},
   *           },
   *         },
   *         published: 'Boolean!',
   *         tags: '[String!]!',
   *       }
   *     }),
   *     schema.buildObjectType({
   *       name: 'AuthorJson',
   *       fields: {
   *         name: 'String!'
   *         birthday: {
   *           type: 'Date!'
   *           extensions: {
   *             dateformat: {
   *               locale: 'ru',
   *             },
   *           },
   *         },
   *       },
   *       interfaces: ['Node'],
   *       extensions: {
   *         infer: false,
   *       },
   *     }),
   *   ]
   *   createTypes(typeDefs)
   * }
   */
  createTypes: (
    types:
      | string
      | GraphQLOutputType
      | GatsbyGraphQLType<any, any>
      | Array<string | GraphQLOutputType | GatsbyGraphQLType<any, any>>,
    plugin: IGatsbyPlugin,
    traceId?: string
  ): ICreateTypes => {
    return {
      type: `CREATE_TYPES`,
      plugin,
      traceId,
      payload: Array.isArray(types)
        ? types.map(parseTypeDef)
        : parseTypeDef(types),
    }
  },

  /**
   * Add a field extension to the GraphQL schema.
   *
   * Extensions allow defining custom behavior which can be added to fields
   * via directive (in SDL) or on the `extensions` prop (with Type Builders).
   *
   * The extension definition takes a `name`, an `extend` function, and optional
   * extension `args` for options. The `extend` function has to return a (partial)
   * field config, and receives the extension options and the previous field config
   * as arguments.
   *
   * @availableIn [createSchemaCustomization, sourceNodes]
   *
   * @param {GraphQLFieldExtensionDefinition} extension The field extension definition
   * @example
   * exports.createSchemaCustomization = ({ actions }) => {
   *   const { createFieldExtension } = actions
   *   createFieldExtension({
   *     name: 'motivate',
   *     args: {
   *       caffeine: 'Int'
   *     },
   *     extend(options, prevFieldConfig) {
   *       return {
   *         type: 'String',
   *         args: {
   *           sunshine: {
   *             type: 'Int',
   *             defaultValue: 0,
   *           },
   *         },
   *         resolve(source, args, context, info) {
   *           const motivation = (options.caffeine || 0) - args.sunshine
   *           if (motivation > 5) return 'Work! Work! Work!'
   *           return 'Maybe tomorrow.'
   *         },
   *       }
   *     },
   *   })
   * }
   */
  createFieldExtension: (
    extension: GraphQLFieldExtensionDefinition,
    plugin: IGatsbyPlugin,
    traceId?: string
  ): ThunkAction<
    void,
    IGatsbyState,
    Record<string, unknown>,
    ICreateFieldExtension
  > => (dispatch, getState): void => {
    const { name } = extension || {}
    const { fieldExtensions } = getState().schemaCustomization

    if (!name) {
      report.error(
        `The provided field extension must have a \`name\` property.`
      )
    } else if (reservedExtensionNames.includes(name)) {
      report.error(
        `The field extension name \`${name}\` is reserved for internal use.`
      )
    } else if (fieldExtensions[name]) {
      report.error(
        `A field extension with the name \`${name}\` has already been registered.`
      )
    } else {
      dispatch({
        type: `CREATE_FIELD_EXTENSION`,
        plugin,
        traceId,
        payload: { name, extension },
      })
    }
  },

  /**
   * Write GraphQL schema to file
   *
   * Writes out inferred and explicitly specified type definitions. This is not
   * the full GraphQL schema, but only the types necessary to recreate all type
   * definitions, i.e. it does not include directives, built-ins, and derived
   * types for filtering, sorting, pagination etc. Optionally, you can define a
   * list of types to include/exclude. This is recommended to avoid including
   * definitions for plugin-created types.
   *
   * The first object parameter is required, however all the fields in the object are optional.
   *
   * @availableIn [createSchemaCustomization]
   *
   * @param {object} $0
   * @param {string} [$0.path] The path to the output file, defaults to `schema.gql`
   * @param {object} [$0.include] Configure types to include
   * @param {string[]} [$0.include.types] Only include these types
   * @param {string[]} [$0.include.plugins] Only include types owned by these plugins
   * @param {object} [$0.exclude] Configure types to exclude
   * @param {string[]} [$0.exclude.types] Do not include these types
   * @param {string[]} [$0.exclude.plugins] Do not include types owned by these plugins
   * @param {boolean} [$0.withFieldTypes] Include field types, defaults to `true`
   * @example
   * exports.createSchemaCustomization = ({ actions }) => {
   *   // This code writes a GraphQL schema to a file named `schema.gql`.
   *   actions.printTypeDefinitions({})
   * }
   * @example
   * exports.createSchemaCustomization = ({ actions }) => {
   *   // This code writes a GraphQL schema to a file named `schema.gql`, but this time it does not include field types.
   *   actions.printTypeDefinitions({ withFieldTypes: false })
   * }
   */
  printTypeDefinitions: (
    {
      path = `schema.gql`,
      include,
      exclude,
      withFieldTypes = true,
    }: {
      path?: string
      include?: { types?: Array<string>; plugins?: Array<string> }
      exclude?: { types?: Array<string>; plugins?: Array<string> }
      withFieldTypes?: boolean
    },
    plugin: IGatsbyPlugin,
    traceId?: string
  ): IPrintTypeDefinitions => {
    return {
      type: `PRINT_SCHEMA_REQUESTED`,
      plugin,
      traceId,
      payload: {
        path,
        include,
        exclude,
        withFieldTypes,
      },
    }
  },

  /**
   * Make functionality available on field resolver `context`
   *
   * @availableIn [createSchemaCustomization]
   *
   * @param {object} context Object to make available on `context`.
   * When called from a plugin, the context value will be namespaced under
   * the camel-cased plugin name without the "gatsby-" prefix
   * @example
   * const getHtml = md => remark().use(html).process(md)
   * exports.createSchemaCustomization = ({ actions }) => {
   *   actions.createResolverContext({ getHtml })
   * }
   * // The context value can then be accessed in any field resolver like this:
   * exports.createSchemaCustomization = ({ actions, schema }) => {
   *   actions.createTypes(schema.buildObjectType({
   *     name: 'Test',
   *     interfaces: ['Node'],
   *     fields: {
   *       md: {
   *         type: 'String!',
   *         async resolve(source, args, context, info) {
   *           const processed = await context.transformerRemark.getHtml(source.internal.contents)
   *           return processed.contents
   *         }
   *       }
   *     }
   *   }))
   * }
   */
  createResolverContext: (
    context: IGatsbyPluginContext,
    plugin: IGatsbyPlugin,
    traceId?: string
  ): ThunkAction<
    void,
    IGatsbyState,
    Record<string, unknown>,
    ICreateResolverContext
  > => (dispatch): void => {
    if (!context || typeof context !== `object`) {
      report.error(
        `Expected context value passed to \`createResolverContext\` to be an object. Received "${context}".`
      )
    } else {
      const { name } = plugin || {}
      const payload =
        !name || name === `default-site-plugin`
          ? context
          : { [camelCase(name.replace(/^gatsby-/, ``))]: context }
      dispatch({
        type: `CREATE_RESOLVER_CONTEXT`,
        plugin,
        traceId,
        payload,
      })
    }
  },
}

const withDeprecationWarning = (
  actionName: RestrictionActionNames,
  action: SomeActionCreator,
  api: API,
  allowedIn: Array<API>
): SomeActionCreator => (
  ...args: Array<any>
): ReturnType<ActionCreator<any>> => {
  report.warn(
    `Calling \`${actionName}\` in the \`${api}\` API is deprecated. ` +
      `Please use: ${allowedIn.map(a => `\`${a}\``).join(`, `)}.`
  )
  return action(...args)
}

const withErrorMessage = (
  actionName: RestrictionActionNames,
  api: API,
  allowedIn: Array<API>
) => () =>
  // return a thunk that does not dispatch anything
  (): void => {
    report.error(
      `\`${actionName}\` is not available in the \`${api}\` API. ` +
        `Please use: ${allowedIn.map(a => `\`${a}\``).join(`, `)}.`
    )
  }

const nodeAPIs = Object.keys(require(`../../utils/api-node-docs`))

const ALLOWED_IN = `ALLOWED_IN`
const DEPRECATED_IN = `DEPRECATED_IN`

type API = string

type Restrictions = Record<
  RestrictionActionNames,
  Partial<{
    ALLOWED_IN: Array<API>
    DEPRECATED_IN: Array<API>
  }>
>

type AvailableActionsByAPI = Record<
  API,
  { [K in RestrictionActionNames]: SomeActionCreator }
>

const set = (
  availableActionsByAPI: Record<string, any>,
  api: API,
  actionName: RestrictionActionNames,
  action: SomeActionCreator
): void => {
  availableActionsByAPI[api] = availableActionsByAPI[api] || {}
  availableActionsByAPI[api][actionName] = action
}

const mapAvailableActionsToAPIs = (
  restrictions: Restrictions
): AvailableActionsByAPI => {
  const availableActionsByAPI: AvailableActionsByAPI = {}

  const actionNames = Object.keys(restrictions) as Array<
    keyof typeof restrictions
  >
  actionNames.forEach(actionName => {
    const action = actions[actionName]

    const allowedIn: Array<API> = restrictions[actionName][ALLOWED_IN] || []
    allowedIn.forEach(api =>
      set(availableActionsByAPI, api, actionName, action)
    )

    const deprecatedIn: Array<API> =
      restrictions[actionName][DEPRECATED_IN] || []
    deprecatedIn.forEach(api =>
      set(
        availableActionsByAPI,
        api,
        actionName,
        withDeprecationWarning(actionName, action, api, allowedIn)
      )
    )

    const forbiddenIn = nodeAPIs.filter(
      api => ![...allowedIn, ...deprecatedIn].includes(api)
    )
    forbiddenIn.forEach(api =>
      set(
        availableActionsByAPI,
        api,
        actionName,
        withErrorMessage(actionName, api, allowedIn)
      )
    )
  })

  return availableActionsByAPI
}

export const availableActionsByAPI = mapAvailableActionsToAPIs({
  createFieldExtension: {
    [ALLOWED_IN]: [`sourceNodes`, `createSchemaCustomization`],
  },
  createTypes: {
    [ALLOWED_IN]: [`sourceNodes`, `createSchemaCustomization`],
    [DEPRECATED_IN]: [`onPreInit`, `onPreBootstrap`],
  },
  createResolverContext: {
    [ALLOWED_IN]: [`createSchemaCustomization`],
  },
  addThirdPartySchema: {
    [ALLOWED_IN]: [`sourceNodes`, `createSchemaCustomization`],
    [DEPRECATED_IN]: [`onPreInit`, `onPreBootstrap`],
  },
  printTypeDefinitions: {
    [ALLOWED_IN]: [`createSchemaCustomization`],
  },
})
