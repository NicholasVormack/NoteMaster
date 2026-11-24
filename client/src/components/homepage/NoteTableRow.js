import React, { useState } from 'react';
import TableRow from '@material-ui/core/TableRow';
import TableCell from '@material-ui/core/TableCell';
import IconButton from '@material-ui/core/IconButton';
import Tooltip from '@material-ui/core/Tooltip';
import Chip from '@material-ui/core/Chip';
import { Delete, Star, StarBorder } from '@material-ui/icons';
import { withRouter } from 'react-router-dom';

const authHeaders = () => ({
  'content-type': 'application/json',
  'x-auth-token': localStorage.getItem('token'),
});

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const NoteTableRow = ({ itemNumber, note, history, onChanged }) => {
  const [busy, setBusy] = useState(false);

  const open = () => {
    history.push({ pathname: '/note', state: { note } });
  };

  const togglePin = async (event) => {
    event.stopPropagation();
    if (busy) return;
    setBusy(true);

    try {
      const response = await fetch(`/api/notes/${note._id}/pin`, {
        method: 'PATCH',
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error('Could not update the pin.');
      if (onChanged) onChanged();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (event) => {
    event.stopPropagation();
    if (busy) return;
    if (!window.confirm(`Delete "${note.title}"? This cannot be undone.`)) return;

    setBusy(true);

    try {
      // The original sent `header:` instead of `headers:`, so no auth token
      // reached the server and every delete failed the auth check.
      const response = await fetch(`/api/notes/${note._id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.msg || 'Could not delete that note.');

      if (onChanged) onChanged();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TableRow hover onClick={open} style={{ cursor: 'pointer' }}>
      <TableCell align="left">{itemNumber}</TableCell>
      <TableCell>
        {note.pinned ? <Star fontSize="inherit" style={{ verticalAlign: 'middle' }} /> : null}{' '}
        {note.title}
      </TableCell>
      <TableCell>
        {(note.tags || []).map((tag) => (
          <Chip
            key={tag}
            label={tag}
            size="small"
            style={{ marginRight: 4, height: 20 }}
          />
        ))}
      </TableCell>
      <TableCell>{formatDate(note.updatedAt)}</TableCell>
      <TableCell onClick={(event) => event.stopPropagation()}>
        <Tooltip title={note.pinned ? 'Unpin note' : 'Pin note'}>
          <span>
            <IconButton size="small" onClick={togglePin} disabled={busy}>
              {note.pinned ? <Star fontSize="small" /> : <StarBorder fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </TableCell>
      <TableCell onClick={(event) => event.stopPropagation()}>
        <Tooltip title="Delete note">
          <span>
            <IconButton size="small" onClick={remove} disabled={busy}>
              <Delete fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
};

export default withRouter(NoteTableRow);
