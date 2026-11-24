/**
 * Note routes.
 *
 * Every route is scoped to the authenticated author. The original handlers
 * looked notes up by `_id` alone, so any signed-in user could edit or delete
 * another user's note by guessing an id; ownership is now part of the query.
 */

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Note = require('../models/note');

const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 24;

const SORTS = {
  recent: { pinned: -1, updatedAt: -1 },
  oldest: { pinned: -1, updatedAt: 1 },
  title: { pinned: -1, title: 1 },
  created: { pinned: -1, createdAt: -1 },
};

/**
 * The JWT payload is `{ username }`; tolerate a bare string as well so the
 * middleware can be changed later without breaking these handlers.
 */
const authorOf = (req) => {
  const subject = req.username;
  if (!subject) return '';
  if (typeof subject === 'string') return subject;
  return subject.username || '';
};

const normalizeTags = (input) => {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  const seen = new Set();

  for (const entry of raw) {
    const clean = String(entry).trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (clean) seen.add(clean);
    if (seen.size >= MAX_TAGS) break;
  }

  return [...seen];
};

/**
 * Slate sends `body` as a JSON string; PUT and POST both accept a string or a
 * parsed document. An unparseable body becomes an empty document rather than
 * throwing a 500 the way `JSON.parse(body)` used to.
 */
const parseBody = (body) => {
  if (Array.isArray(body)) return body;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }
  if (body && typeof body === 'object') return [body];
  return [];
};

/** Flatten a Slate document into searchable text. */
const extractText = (nodes) => {
  const parts = [];

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node.text === 'string') parts.push(node.text);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };

  walk(nodes);
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 20000);
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const badRequest = (res, msg) => res.status(400).json({ msg });

/* -------------------------------------------------------------------------- */
/* List                                                                       */
/* -------------------------------------------------------------------------- */

router.get('/', async (req, res) => {
  try {
    const filter = { author: authorOf(req) };

    const tag = (req.query.tag || '').toString().trim().toLowerCase();
    if (tag) filter.tags = tag;

    const term = (req.query.q || '').toString().trim();
    if (term) {
      const pattern = new RegExp(escapeRegex(term), 'i');
      filter.$or = [{ title: pattern }, { plainText: pattern }, { tags: pattern }];
    }

    const sort = SORTS[(req.query.sort || 'recent').toString()] || SORTS.recent;
    const notes = await Note.find(filter).sort(sort).limit(500).lean();

    return res.json(notes);
  } catch (error) {
    return res.status(500).json({ msg: 'Could not load notes.' });
  }
});

/* -------------------------------------------------------------------------- */
/* Read one                                                                   */
/* -------------------------------------------------------------------------- */

router.get('/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid note id.');

  try {
    const note = await Note.findOne({ _id: req.params.id, author: authorOf(req) }).lean();
    if (!note) return res.status(404).json({ msg: 'No note found with that id.' });
    return res.json(note);
  } catch (error) {
    return res.status(500).json({ msg: 'Could not load that note.' });
  }
});

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

router.post('/', async (req, res) => {
  const { title, body, videoLink, videoTimestamp, tags } = req.body || {};
  const cleanTitle = typeof title === 'string' ? title.trim() : '';

  if (!cleanTitle) return badRequest(res, 'A note needs a title.');
  if (cleanTitle.length > 200) return badRequest(res, 'Titles are limited to 200 characters.');

  try {
    const document = parseBody(body);
    const note = await Note.create({
      title: cleanTitle,
      body: document,
      plainText: extractText(document),
      author: authorOf(req),
      videoLink: typeof videoLink === 'string' ? videoLink : '',
      videoTimestamp: Number(videoTimestamp) || 0,
      tags: normalizeTags(tags),
    });

    return res.status(201).json(note);
  } catch (error) {
    return res.status(500).json({ msg: 'Could not save the note.' });
  }
});

/* -------------------------------------------------------------------------- */
/* Update                                                                     */
/* -------------------------------------------------------------------------- */

router.put('/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid note id.');

  const { title, body, videoLink, videoTimestamp, tags } = req.body || {};
  const cleanTitle = typeof title === 'string' ? title.trim() : '';

  if (!cleanTitle) return badRequest(res, 'A note needs a title.');

  try {
    const note = await Note.findOne({ _id: req.params.id, author: authorOf(req) });
    if (!note) return res.status(404).json({ msg: 'No note found with that id.' });

    const document = parseBody(body);
    note.title = cleanTitle;
    note.body = document;
    note.plainText = extractText(document);
    note.videoLink = typeof videoLink === 'string' ? videoLink : note.videoLink;
    note.videoTimestamp =
      videoTimestamp === undefined ? note.videoTimestamp : Number(videoTimestamp) || 0;
    if (tags !== undefined) note.tags = normalizeTags(tags);

    const saved = await note.save();
    return res.json(saved);
  } catch (error) {
    return res.status(500).json({ msg: 'Could not update the note.' });
  }
});

/* -------------------------------------------------------------------------- */
/* Pin / unpin                                                                */
/* -------------------------------------------------------------------------- */

router.patch('/:id/pin', async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid note id.');

  try {
    const note = await Note.findOne({ _id: req.params.id, author: authorOf(req) });
    if (!note) return res.status(404).json({ msg: 'No note found with that id.' });

    note.pinned = !note.pinned;
    const saved = await note.save();
    return res.json(saved);
  } catch (error) {
    return res.status(500).json({ msg: 'Could not update the note.' });
  }
});

/* -------------------------------------------------------------------------- */
/* Delete                                                                     */
/* -------------------------------------------------------------------------- */

router.delete('/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid note id.');

  try {
    const deleted = await Note.findOneAndDelete({
      _id: req.params.id,
      author: authorOf(req),
    });
    if (!deleted) return res.status(404).json({ msg: 'No note found with that id.' });
    return res.json({ msg: 'success', deleted: deleted._id });
  } catch (error) {
    return res.status(500).json({ msg: 'Could not delete the note.' });
  }
});

module.exports = router;
