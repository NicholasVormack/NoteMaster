/**
 * Note model.
 *
 * Two fields exist purely to make the list view fast and the search honest:
 *
 *   tags      normalised on write (lowercase, deduped, capped) so filtering is
 *             an exact match instead of a case-insensitive scan.
 *   plainText a flattened projection of the Slate document, produced on write,
 *             so full-text search does not have to walk JSON at query time.
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const NoteSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    body: {
      type: Schema.Types.Mixed,
      default: [],
    },
    plainText: {
      type: String,
      default: '',
      index: true,
    },
    author: {
      type: String,
      required: true,
      index: true,
    },
    videoLink: {
      type: String,
      default: '',
    },
    videoTimestamp: {
      type: Number,
      default: 0,
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    pinned: {
      type: Boolean,
      default: false,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// The list query is always "this author's notes, pinned first, newest first".
NoteSchema.index({ author: 1, pinned: -1, updatedAt: -1 });

module.exports = mongoose.model('Note', NoteSchema);
