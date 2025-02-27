const _ = require(`lodash`)
const path = require(`path`)
const v8 = require(`v8`)
const reporter = require(`@colin3dmax/gatsby-cli/lib/reporter`)

const writeToCache = jest.spyOn(require(`../persist`), `writeToCache`)
const v8Serialize = jest.spyOn(v8, `serialize`)
const v8Deserialize = jest.spyOn(v8, `deserialize`)
const reporterInfo = jest.spyOn(reporter, `info`).mockImplementation(jest.fn)
const reporterWarn = jest.spyOn(reporter, `warn`).mockImplementation(jest.fn)

const { saveState, store, readState } = require(`../index`)

const {
  actions: { createPage, createNode },
} = require(`../actions`)

const mockWrittenContent = new Map()
const mockCompatiblePath = path
jest.mock(`fs-extra`, () => {
  return {
    writeFileSync: jest.fn((file, content) =>
      mockWrittenContent.set(file, content)
    ),
    readFileSync: jest.fn(file => mockWrittenContent.get(file)),
    moveSync: jest.fn((from, to) => {
      // This will only work for folders if they are always the full prefix
      // of the file... (that goes for both input dirs). That's the case here.
      if (mockWrittenContent.has(to)) {
        throw new Error(`File/folder exists`)
      }

      // Move all files in this folder as well ... :/
      mockWrittenContent.forEach((value, key) => {
        if (key.startsWith(from)) {
          // rename('foo/bar', 'a/b/c') => foo/bar/ding.js -> a/b/c/ding.js
          // (.replace with string arg will only replace the first occurrence)
          mockWrittenContent.set(
            key.replace(from, to),
            mockWrittenContent.get(key)
          )
          mockWrittenContent.delete(key)
        }
      })
    }),
    existsSync: jest.fn(target => mockWrittenContent.has(target)),
    mkdtempSync: jest.fn(suffix => {
      const dir = mockCompatiblePath.join(
        `some`,
        `tmp` + suffix + Math.random()
      )
      mockWrittenContent.set(dir, Buffer(`empty dir`))
      return dir
    }),
    removeSync: jest.fn(file => mockWrittenContent.delete(file)),
  }
})
jest.mock(`glob`, () => {
  return {
    sync: jest.fn(pattern => {
      // Tricky.
      // Expecting a path prefix, ending with star. Else this won't work :/
      if (pattern.slice(-1) !== `*`) {
        throw new Error(`Expected pattern ending with star`)
      }
      const globPrefix = pattern.slice(0, -1)
      if (globPrefix.includes(`*`)) {
        throw new Error(`Expected pattern to be a prefix`)
      }
      const files = []
      mockWrittenContent.forEach((value, key) => {
        if (key.startsWith(globPrefix)) {
          files.push(key)
        }
      })
      return files
    }),
  }
})

function getFakeNodes() {
  // Set nodes to something or the cache will fail because it asserts this
  // Actual nodes content should match TS type; these are verified
  const map /* : Map<string, IReduxNode>*/ = new Map()
  map.set(`pageA`, {
    id: `pageA`,
    internal: {
      type: `Ding`,
    },
  })
  map.set(`pageB`, {
    id: `pageB`,
    internal: {
      type: `Dong`,
    },
  })
  return map
}

describe(`redux db`, () => {
  const initialComponentsState = _.cloneDeep(store.getState().components)

  function createPages(pages) {
    // mock Date.now so Date.now() doesn't change in between tests
    const RealDateNow = Date.now
    let DateNowCallCount = 0
    // simulate passage of time by increasing call counter (instead of actual time value)
    Date.now = jest.fn(() => ++DateNowCallCount)

    store.dispatch(
      (Array.isArray(pages) ? pages : [pages]).map(page =>
        createPage(page, {
          name: `default-site-plugin`,
        })
      )
    )

    Date.now = RealDateNow
  }

  const defaultPage = {
    path: `/my-sweet-new-page/`,
    // seems like jest serializer doesn't play nice with Maps on Windows
    component: `/Users/username/dev/site/src/templates/my-sweet-new-page.js`,
    // The context is passed as props to the component as well
    // as into the component's GraphQL query.
    context: {
      id: `123456`,
    },
  }

  beforeEach(() => {
    store.dispatch({
      type: `DELETE_CACHE`,
    })
    writeToCache.mockClear()
    mockWrittenContent.clear()
    reporterWarn.mockClear()
    reporterInfo.mockClear()
  })

  it(`should write redux cache to disk`, async () => {
    createPages(defaultPage)

    expect(initialComponentsState).toEqual(new Map())

    store.getState().nodes = getFakeNodes()

    await saveState()

    expect(writeToCache).toBeCalled()

    // reset state in memory
    store.dispatch({
      type: `DELETE_CACHE`,
    })
    // make sure store in memory is empty
    expect(store.getState().components).toEqual(initialComponentsState)

    // read data that was previously cached
    const data = readState()

    // make sure data was read and is not the same as our clean redux state
    expect(data.components).not.toEqual(initialComponentsState)

    expect(data).toMatchSnapshot()
  })

  describe(`GATSBY_DISABLE_CACHE_PERSISTENCE`, () => {
    beforeAll(() => {
      process.env.GATSBY_DISABLE_CACHE_PERSISTENCE = `truthy`
    })

    afterAll(() => {
      delete process.env.GATSBY_DISABLE_CACHE_PERSISTENCE
    })
    it(`shouldn't write redux cache to disk when GATSBY_DISABLE_CACHE_PERSISTENCE env var is used`, async () => {
      expect(initialComponentsState).toEqual(new Map())

      store.getState().nodes = getFakeNodes()

      await saveState()

      expect(writeToCache).not.toBeCalled()
    })
  })

  describe(`Sharding`, () => {
    afterAll(() => {
      v8Serialize.mockRestore()
      v8Deserialize.mockRestore()
    })

    // we set limit to 1.5 * 1024 * 1024 * 1024 per shard
    // simulating size for page and nodes will allow us to see if we create expected amount of shards
    // and that we stitch them back together correctly
    const nodeShardsScenarios = [
      {
        numberOfNodes: 50000,
        simulatedNodeObjectSize: 5 * 1024,
        expectedNumberOfNodeShards: 1,
      },
      {
        numberOfNodes: 50,
        simulatedNodeObjectSize: 5 * 1024 * 1024,
        expectedNumberOfNodeShards: 1,
      },
      {
        numberOfNodes: 5,
        simulatedNodeObjectSize: 0.6 * 1024 * 1024 * 1024,
        expectedNumberOfNodeShards: 3,
      },
    ]
    const pageShardsScenarios = [
      {
        numberOfPages: 50 * 1000,
        simulatedPageObjectSize: 10 * 1024,
        expectedNumberOfPageShards: 1,
        expectedPageContextSizeWarning: false,
      },
      {
        numberOfPages: 50,
        simulatedPageObjectSize: 10 * 1024 * 1024,
        expectedNumberOfPageShards: 1,
        expectedPageContextSizeWarning: true,
      },
      {
        numberOfPages: 5,
        simulatedPageObjectSize: 0.9 * 1024 * 1024 * 1024,
        expectedNumberOfPageShards: 5,
        expectedPageContextSizeWarning: true,
      },
    ]

    const scenarios = []
    for (const nodeShardsParams of nodeShardsScenarios) {
      for (const pageShardsParams of pageShardsScenarios) {
        scenarios.push([
          nodeShardsParams.numberOfNodes,
          nodeShardsParams.simulatedNodeObjectSize,
          nodeShardsParams.expectedNumberOfNodeShards,
          pageShardsParams.numberOfPages,
          pageShardsParams.simulatedPageObjectSize,
          pageShardsParams.expectedNumberOfPageShards,
          pageShardsParams.expectedPageContextSizeWarning
            ? `with page context size warning`
            : `without page context size warning`,
          pageShardsParams.expectedPageContextSizeWarning,
        ])
      }
    }

    it.each(scenarios)(
      `Scenario Nodes %i x %i bytes = %i shards / Pages %i x %i bytes = %i shards (%s)`,
      async (
        numberOfNodes,
        simulatedNodeObjectSize,
        expectedNumberOfNodeShards,
        numberOfPages,
        simulatedPageObjectSize,
        expectedNumberOfPageShards,
        _expectedPageContextSizeWarningLabelForTestName,
        expectedPageContextSizeWarning
      ) => {
        // just some baseline checking to make sure test setup is correct - check both in-memory state and persisted state
        // and make sure it's empty
        const initialStateInMemory = store.getState()
        expect(initialStateInMemory.pages).toEqual(new Map())
        expect(initialStateInMemory.nodes).toEqual(new Map())

        // we expect to have no persisted state yet - this returns empty object
        // and let redux to use initial states for all redux slices
        const initialPersistedState = readState()
        expect(initialPersistedState.pages).toBeUndefined()
        expect(initialPersistedState.nodes).toBeUndefined()
        expect(initialPersistedState).toEqual({})

        for (let nodeIndex = 0; nodeIndex < numberOfNodes; nodeIndex++) {
          store.dispatch(
            createNode(
              {
                id: `node-${nodeIndex}`,
                context: {
                  objectType: `node`,
                },
                internal: {
                  type: `Foo`,
                  contentDigest: `contentDigest-${nodeIndex}`,
                },
              },
              { name: `gatsby-source-test` }
            )
          )
        }

        createPages(
          new Array(numberOfPages).fill(undefined).map((_, index) => {
            return {
              path: `/page-${index}/`,
              component: `/Users/username/dev/site/src/templates/my-sweet-new-page.js`,
              context: {
                objectType: `page`,
                possiblyHugeField: `let's pretend this field is huge (we will simulate that by mocking some things used to asses size of object)`,
              },
            }
          })
        )

        const currentStateInMemory = store.getState()
        expect(currentStateInMemory.nodes.size).toEqual(numberOfNodes)
        expect(currentStateInMemory.pages.size).toEqual(numberOfPages)

        // this is just to make sure that any implementation changes in readState
        // won't affect this test - so we clone current state of things and will
        // use that for assertions
        const clonedCurrentNodes = new Map(currentStateInMemory.nodes)
        const clonedCurrentPages = new Map(currentStateInMemory.pages)

        // we expect to have no persisted state yet and that current in-memory state doesn't affect it
        const persistedStateBeforeSaving = readState()
        expect(persistedStateBeforeSaving.pages).toBeUndefined()
        expect(persistedStateBeforeSaving.nodes).toBeUndefined()
        expect(persistedStateBeforeSaving).toEqual({})

        // simulate that nodes/pages have sizes set in scenario parameters
        // it changes implementation to JSON.stringify because calling v8.serialize
        // again cause max stack size errors :shrug: - this also requires adjusting
        // deserialize implementation
        v8Serialize.mockImplementation(obj => {
          if (obj?.[1]?.context?.objectType === `node`) {
            return {
              toString: () => JSON.stringify(obj),
              length: simulatedNodeObjectSize,
            }
          } else if (obj?.[1]?.context?.objectType === `page`) {
            return {
              toString: () => JSON.stringify(obj),
              length: simulatedPageObjectSize,
            }
          } else {
            return JSON.stringify(obj)
          }
        })
        v8Deserialize.mockImplementation(obj => JSON.parse(obj.toString()))

        await saveState()

        if (expectedPageContextSizeWarning) {
          expect(reporterWarn).toBeCalledWith(
            `The size of at least one page context chunk exceeded 500kb, which could lead to degraded performance. Consider putting less data in the page context.`
          )
        } else {
          expect(reporterWarn).not.toBeCalled()
        }

        const shardsWritten = {
          rest: 0,
          node: 0,
          page: 0,
        }

        for (const fileWritten of mockWrittenContent.keys()) {
          const basename = path.basename(fileWritten)
          if (basename.startsWith(`redux.rest`)) {
            shardsWritten.rest++
          } else if (basename.startsWith(`redux.node`)) {
            shardsWritten.node++
          } else if (basename.startsWith(`redux.page`)) {
            shardsWritten.page++
          }
        }

        expect(writeToCache).toBeCalled()

        expect(shardsWritten.rest).toEqual(1)
        expect(shardsWritten.node).toEqual(expectedNumberOfNodeShards)
        expect(shardsWritten.page).toEqual(expectedNumberOfPageShards)

        // and finally - let's make sure that reading shards stitches it back together
        // correctly
        const persistedStateAfterSaving = readState()

        expect(persistedStateAfterSaving.nodes).toEqual(clonedCurrentNodes)
        expect(persistedStateAfterSaving.pages).toEqual(clonedCurrentPages)
      }
    )
  })

  it(`doesn't discard persisted cache if no pages`, () => {
    expect(store.getState().nodes.size).toEqual(0)
    expect(store.getState().pages.size).toEqual(0)

    store.dispatch(
      createNode(
        {
          id: `node-test`,
          context: {
            objectType: `node`,
          },
          internal: {
            type: `Foo`,
            contentDigest: `contentDigest-test`,
          },
        },
        { name: `gatsby-source-test` }
      )
    )

    expect(store.getState().nodes.size).toEqual(1)
    expect(store.getState().pages.size).toEqual(0)

    let persistedState = readState()

    expect(persistedState.nodes?.size ?? 0).toEqual(0)
    expect(persistedState.pages?.size ?? 0).toEqual(0)

    saveState()

    // reset state in memory
    store.dispatch({
      type: `DELETE_CACHE`,
    })

    expect(store.getState().nodes.size).toEqual(0)
    expect(store.getState().pages.size).toEqual(0)

    persistedState = readState()

    expect(persistedState.nodes?.size ?? 0).toEqual(1)
    expect(persistedState.pages?.size ?? 0).toEqual(0)
  })

  it(`discards persisted cache if no nodes are stored there`, () => {
    expect(store.getState().nodes.size).toEqual(0)
    expect(store.getState().pages.size).toEqual(0)

    createPages(defaultPage)

    expect(store.getState().nodes.size).toEqual(0)
    expect(store.getState().pages.size).toEqual(1)

    let persistedState = readState()

    expect(persistedState.nodes?.size ?? 0).toEqual(0)
    expect(persistedState.pages?.size ?? 0).toEqual(0)

    saveState()

    // reset state in memory
    store.dispatch({
      type: `DELETE_CACHE`,
    })

    expect(store.getState().nodes.size).toEqual(0)
    expect(store.getState().pages.size).toEqual(0)

    persistedState = readState()

    expect(persistedState.nodes?.size ?? 0).toEqual(0)
    // we expect state to be discarded because gatsby creates it least few nodes of it's own
    // (particularly `Site` node). If there was nodes read this likely means something went wrong
    // and state is not consistent
    expect(persistedState.pages?.size ?? 0).toEqual(0)

    expect(reporterInfo).toBeCalledWith(
      `Cache exists but contains no nodes. There should be at least some nodes available so it seems the cache was corrupted. Disregarding the cache and proceeding as if there was none.`
    )
  })
})
