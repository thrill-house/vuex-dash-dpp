import Dash from "dash";
import localforage from "localforage";
import {
  each,
  head,
  includes,
  invokeMap,
  isEqual,
  keyBy,
  keys,
  omit,
  once,
  pickBy,
  reduce,
  startsWith,
  stubArray,
  times,
  zipObject,
} from "lodash-es";

const MAX_DOCUMENTS_PER_QUERY = 100;
const MAX_KILOBYTES_PER_PAYLOAD = 4;
const MAX_DOCUMENTS_PER_PAYLOAD = 10;

const regulatePayload = (payload) => {
  const payloadKeys = keys(payload);
  const payloadValues = times(payloadKeys.length, stubArray);
  const included = zipObject(payloadKeys, payloadValues);
  const remainder = zipObject(payloadKeys, payloadValues);
  let size = 0;
  let limit = 0;

  each(payload, (items, key) => {
    each(items, (item) => {
      const encoded = new TextEncoder().encode(JSON.stringify(item));

      size += encoded.length / 1024;
      limit += 1;

      if (
        size < MAX_KILOBYTES_PER_PAYLOAD &&
        limit <= MAX_DOCUMENTS_PER_PAYLOAD
      ) {
        included[key] = [...included[key], item];
      } else {
        remainder[key] = [...remainder[key], item];
      }
    });
  });

  return {
    included,
    remainder,
  };
};

export default (config) => {
  const defaultOptions = {
    // Namespace for the plugin.
    namespace: "dash",
    // List of documents to be fetched from Dash drive
    documents: [],

    // The network to connect to. One of "livenet", "testnet", "evonet"
    network: "livenet",
    // The contract to sync with
    contractId: null,
    // The identity to use for making changes
    // Attempts to create, edit or delete documents will fail if not included
    identityId: null,
    // The mnemonic to use for making changes
    // Attempts to create, edit or delete documents will fail if not included
    mnemonic: null,
    // An object that is passed into queries retrieving all documents.
    // Can include conditions so that only documents matching a certain set of parameters are returned.
    // By default it will return everything
    allQuery: {},

    // Map root state values or getters to the plugin state, so that connection details can be changed dynamically.
    // Accepts a tuple, with the first parameter being an array of field names present in the root state or existing as getters.
    // Second parameter is an array of mutations present on the root state that the plugin should subscribe to to watch for changes in the values from the first array.
    subscribeToFrom: [[], []],
  };

  // Merge default options with constructor config
  const pluginOptions = { ...defaultOptions, ...config };

  // Destructure constants that can no longer change through a subscription
  const { namespace, subscribeToFrom } = pluginOptions;

  // Destructure subscription tuple to return list of values and mutations to subscribe and sync
  const [subscriptions, fromRoot] = subscribeToFrom;

  // Install plugin
  return (store) => {
    // Create a module within the provided namespace
    store.registerModule(namespace, {
      namespaced: true,
      state: () => ({
        // Pass in the remaining options as our initial state
        options: pluginOptions,

        // Account state defaults
        account: null,
        accountInit: null,
        accountSynced: false,
        accountSyncing: false,

        // Identity state defaults
        identity: null,
        identityInit: null,
        identitySynced: false,
        identitySyncing: false,
        identityRegistering: false,
      }),
      getters: {
        options: (state) => {
          return state.options;
        },

        // Connection is dynamically created on demand and uses values from the local state.
        connection: (state) => {
          return {
            network: state.options.network,
            wallet: {
              mnemonic: state.options.mnemonic,
              adapter: localforage,
              unsafeOptions: {
                skipSynchronizationBeforeHeight: 415000,
              },
            },
            apps: {
              Contract: {
                contractId: state.options.contractId,
              },
            },
          };
        },

        // Client uses the dynamic connection details above
        client: (state, getters) => {
          return new Dash.Client(getters.connection);
        },

        // Account related getters
        accountSynced: (state) => state?.accountSynced,
        accountSyncing: (state) => state?.accountSyncing,
        account: (state, getters) => {
          if (
            state.account &&
            typeof state.account === "function" &&
            getters.accountSynced
          ) {
            return state.account();
          }

          if (state.accountInit && typeof state.accountInit === "function") {
            state.accountInit();
          }

          return null;
        },
        unusedAddress: (state, getters) => {
          if (getters.account && getters.accountSynced) {
            const { address } = getters.account.getUnusedAddress();
            return address;
          }

          return null;
        },
        confirmedBalance: (state, getters) => {
          if (getters.account && getters.accountSynced) {
            return getters.account.getConfirmedBalance();
          }

          return 0;
        },
        unconfirmedBalance: (state, getters) => {
          if (getters.account && getters.accountSynced) {
            return getters.account.getUnconfirmedBalance();
          }

          return 0;
        },

        // Identity related getters
        identitySynced: (state) => state?.identitySynced,
        identitySyncing: (state) => state?.identitySyncing,
        identityRegistering: (state) => state?.identityRegistering,
        identities: (state, getters) => {
          if (
            getters.account &&
            getters.accountSynced &&
            (getters.identityRegistering || !getters.identityRegistering)
          ) {
            return getters.account.identities.getIdentityIds();
          }

          return [];
        },
        identity: (state, getters) => {
          if (
            state.identity &&
            typeof state.identity === "function" &&
            getters.identitySynced
          ) {
            return state.identity();
          }

          if (
            getters.options.identityId &&
            state.identityInit &&
            typeof state.identityInit === "function"
          ) {
            state.identityInit();
          }

          return null;
        },
        credit: (state, getters) => {
          if (getters.identity && getters.identitySynced) {
            return getters.identity.getBalance();
          }

          return 0;
        },

        // Utility getters
        balance: (state, getters) => {
          return {
            confirmed: getters.confirmedBalance,
            unconfirmed: getters.unconfirmedBalance,
            credit: getters.credit,
          };
        },
      },
      mutations: {
        // Account related mutations
        account: (state, payload) => {
          state.account = payload;
        },
        accountInit: (state, payload) => {
          state.accountInit = payload;
        },
        accountSynced: (state, payload) => {
          state.accountSynced = payload;
        },
        accountSyncing: (state, payload) => {
          state.accountSyncing = payload;
        },

        // Identity related mutations
        identity: (state, payload) => {
          state.identity = payload;
        },
        identityInit: (state, payload) => {
          state.identityInit = payload;
        },
        identitySynced: (state, payload) => {
          state.identitySynced = payload;
        },
        identitySyncing: (state, payload) => {
          state.identitySyncing = payload;
        },
        identityRegistering: (state, payload) => {
          state.identityRegistering = payload;
        },

        // Update options
        updateOptions: (state, payload) => {
          state.options = { ...state.options, ...payload };
        },
      },
      actions: {
        // Init action, this will get run automatically when necessary to reinitialise the wallet account
        init: async ({ commit, getters, dispatch }) => {
          // Reset everything account related that might have been persisted
          commit("account", null);
          commit("accountSynced", false);
          commit("accountSyncing", false);

          // Reset everything identity related that might have been persisted
          commit("identity", null);
          commit("identitySynced", false);
          commit("identitySyncing", false);
          commit("identityRegistering", false);

          // If we have a mnemonic, we can try to fetch an account
          if (getters.options.mnemonic) {
            commit(
              "accountInit",
              once(() => dispatch("accountInit"))
            );
          } else {
            commit("accountInit", null);
          }

          // If we have an identity ID, we can try to fetch the identity
          if (getters.options.identityId) {
            commit(
              "identityInit",
              once(() => dispatch("identityInit"))
            );
          } else {
            commit("identityInit", null);
          }
        },

        accountInit: async ({ commit, getters }) => {
          commit("accountSyncing", true);

          try {
            const account = await getters.client.getWalletAccount();

            account.on("TRANSACTION", () => {
              commit("accountSynced", Date.now());
            });

            commit("account", () => account);
            commit("accountInit", null);
            commit("accountSynced", Date.now());
          } catch (e) {
            console.debug(e);
          }

          commit("accountSyncing", false);
        },

        identityInit: async ({ commit, getters }) => {
          commit("identitySyncing", true);

          try {
            const identity = await getters.client.platform.identities.get(
              getters.options.identityId
            );

            commit("identity", () => identity);
            commit("identityInit", null);
            commit("identitySynced", Date.now());
          } catch (e) {
            console.debug(e);
          }

          commit("identitySyncing", false);
        },

        register: async ({ commit, getters }) => {
          commit("identityRegistering", true);
          let register = null;

          try {
            register = await getters.client.platform.identities.register();
          } catch (e) {
            console.debug(e);
          }

          commit("identityRegistering", false);

          return register;
        },

        // Helper to run the "all" action for every document module
        all: async ({ dispatch, state, ...rest }) => {
          each(state.options.documents, (document) => {
            dispatch(`${document}/all`);
          });
        },
      },
    });

    store.watch(
      (state) => state[namespace].options.documents,
      (newDocuments, oldDocuments) => {
        // Remove old modules
        each(oldDocuments, (document) => {
          store.unregisterModule([namespace, document]);
        });
        // Dynamically create a module for each document in the list
        each(newDocuments, (document) => {
          store.registerModule([namespace, document], {
            namespaced: true,
            state: {
              documents: {},
            },
            getters: {
              all: (state) => state.documents,
              one: (state) => (id) => state.documents?.[id],
            },
            mutations: {
              all: (state, payload) => {
                const documents = keyBy(invokeMap(payload, "toJSON"), "$id");
                state.documents = documents;
              },
              one: (state, payload) => {
                const document = payload.toJSON();
                state.documents = {
                  ...state.documents,
                  [document.$id]: document,
                };
              },
              remove: (state, payload) => {
                const document = payload.toJSON();
                state.documents = {
                  ...omit(state.documents, document.$id),
                };
              },
            },
            actions: {
              // Helper that wraps the "retrieve" action with a query to fetch all documents.
              // The `allQuery` parameter can be customised in plugin options.
              all: async ({
                dispatch,
                commit,
                rootState: {
                  [namespace]: { options },
                },
              }) => {
                let all = [];
                let page = 0;

                while (all.length >= page * MAX_DOCUMENTS_PER_QUERY) {
                  const query = {
                    ...options.allQuery,
                    startAt: page * MAX_DOCUMENTS_PER_QUERY,
                    limit: MAX_DOCUMENTS_PER_QUERY,
                  };

                  all = [...all, ...(await dispatch("retrieve", query))];

                  page++;
                }

                commit("all", all);

                return all;
              },

              // Helper to wrap the "retrieve" action to return the first document matching the `id` passed in the payload.
              one: async ({ dispatch, commit }, payload = null) => {
                const one = head(
                  await dispatch("retrieve", {
                    where: [["$id", "==", payload]],
                  })
                );

                commit("one", one);

                return one;
              },

              // Retrieve from documents. `payload` is a query.
              retrieve: async ({ rootGetters }, payload = {}) => {
                return await rootGetters[
                  `${namespace}/client`
                ].platform.documents.get(`Contract.${document}`, payload);
              },

              compose: async ({ rootGetters }, payload = {}) => {
                const client = rootGetters[`${namespace}/client`];

                try {
                  const composed = await client.platform.documents.create(
                    `Contract.${document}`,
                    rootGetters[`${namespace}/identity`],
                    payload
                  );

                  return composed;
                } catch (e) {
                  console.debug(e);
                }
              },

              multiple: async ({ commit, dispatch }, payload = {}) => {
                const { remainder, included } = regulatePayload({
                  items: payload,
                });

                const documents = {
                  create: [],
                  replace: [],
                  delete: [],
                };

                try {
                  for await (const item of included.items) {
                    if (isEqual(keys(item), ["$id"])) {
                      const deleted = await dispatch("one", item.$id);

                      documents.delete.push(deleted);
                    } else if (item.$id) {
                      const replaced = await dispatch("one", item.$id);

                      replaced.setData(
                        pickBy(item, (value, key) => !startsWith(key, "$"))
                      );

                      documents.replace.push(replaced);
                    } else {
                      const created = await dispatch("compose", item);

                      documents.create.push(created);
                    }
                  }

                  const success = await dispatch("broadcast", documents);

                  if (success) {
                    each(
                      [...documents.create, ...documents.replace],
                      (document) => {
                        commit("one", document);
                      }
                    );
                    each(documents.delete, (document) => {
                      commit("remove", document);
                    });

                    if (remainder.length) {
                      return await dispatch("multiple", remainder.items);
                    }

                    return true;
                  }
                } catch (e) {
                  console.debug(e);
                }
              },

              // Create a new document. `payload` is the content of the document to create.
              create: async ({ commit, dispatch }, payload = {}) => {
                try {
                  const created = await dispatch("compose", payload);

                  const success = await dispatch("broadcast", {
                    create: [created],
                  });

                  if (success) {
                    commit("one", created);
                  }
                } catch (e) {
                  console.debug(e);
                }
              },

              // Replace a document. `payload` is the content of the document to replace and must include an `$id`.
              replace: async ({ dispatch, commit }, payload = {}) => {
                try {
                  const replaced = await dispatch("one", payload.$id);

                  replaced.setData(payload);

                  const success = await dispatch("broadcast", {
                    replace: [replaced],
                  });

                  if (success) {
                    commit("one", replaced);
                  }
                } catch (e) {
                  console.debug(e);
                }
              },

              // Delete a document. `payload` must include an `$id`.
              delete: async ({ dispatch, commit }, payload = {}) => {
                try {
                  const deleted = await dispatch("one", payload.$id);

                  const success = await dispatch("broadcast", {
                    delete: [deleted],
                  });

                  if (success) {
                    commit("remove", deleted);
                  }
                } catch (e) {
                  console.debug(e);
                }
              },

              // Broadcast a set of documents. Payload is an object with create, replace and or delete keys.
              broadcast: async ({ dispatch, rootGetters }, payload = {}) => {
                try {
                  const { remainder, included } = regulatePayload(payload);

                  if (
                    included.create.length ||
                    included.replace.length ||
                    included.delete.length
                  ) {
                    const client = rootGetters[`${namespace}/client`];

                    await client.platform.documents.broadcast(
                      included,
                      rootGetters[`${namespace}/identity`]
                    );
                  }

                  if (
                    remainder.create.length ||
                    remainder.replace.length ||
                    remainder.delete.length
                  ) {
                    return dispatch("broadcast", remainder);
                  }

                  return true;
                } catch (e) {
                  console.debug(e);
                }

                return false;
              },
            },
          });
        });

        store.dispatch(`${namespace}/all`);
      }
    );

    // Subscribe to root store mutations and sync root state values and getters to the plugin options.
    store.subscribe(({ type }, state) => {
      if (type === `${namespace}/updateOptions`) {
        store.dispatch(`${namespace}/init`);
      } else if (includes(fromRoot, type)) {
        const combined = { ...state, ...store.getters };
        const updatedOptions = reduce(
          subscriptions,
          (result, value, key) => {
            result[key] = combined[value];
            return result;
          },
          {}
        );
        store.commit(`${namespace}/updateOptions`, updatedOptions);
      }
    });

    store.dispatch(`${namespace}/init`);
  };
};
