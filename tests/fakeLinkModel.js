// A minimal in-memory stand-in for the Mongoose model.
//
// The store only uses findOneAndUpdate, create and findOne().select(), so the
// fake implements exactly those — enough to test the dedupe, edit-token and
// sliding-expiry rules without a mongod running in CI.

export class DuplicateKeyError extends Error {
  constructor() {
    super("E11000 duplicate key error");
    this.code = 11000;
  }
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => doc[key] === value);
}

export function createFakeLinkModel() {
  const rows = [];

  function wrap(row) {
    // Returned rows behave like documents: mutate fields, then save().
    return Object.assign(row, {
      save: async () => {
        row.updatedAt = new Date();
        return row;
      },
    });
  }

  return {
    rows,

    async create(doc) {
      if (rows.some((row) => row.code === doc.code)) throw new DuplicateKeyError();
      const row = { ...doc, createdAt: new Date(), updatedAt: new Date() };
      rows.push(row);
      return wrap(row);
    },

    async findOneAndUpdate(filter, update, options = {}) {
      const row = rows.find((candidate) => matches(candidate, filter));
      if (!row) return null;
      Object.assign(row, update.$set ?? {});
      return options.new ? wrap(row) : wrap({ ...row });
    },

    findOne(filter) {
      const row = rows.find((candidate) => matches(candidate, filter));
      // .select() is a no-op here: the fake never hides editTokenHash, which is
      // fine because the store always asks for it explicitly.
      return { select: async () => (row ? wrap(row) : null) };
    },
  };
}
