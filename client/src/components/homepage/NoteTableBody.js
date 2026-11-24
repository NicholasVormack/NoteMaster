import React from 'react';
import TableBody from '@material-ui/core/TableBody';
import TableRow from '@material-ui/core/TableRow';
import TableCell from '@material-ui/core/TableCell';
import NoteTableRow from './NoteTableRow';

const NoteTableBody = ({ notes, onChanged }) => {
  if (!Array.isArray(notes) || notes.length === 0) {
    return (
      <TableBody>
        <TableRow>
          <TableCell colSpan={6} align="center" style={{ padding: '24px' }}>
            No notes to show.
          </TableCell>
        </TableRow>
      </TableBody>
    );
  }

  return (
    <TableBody>
      {notes.map((note, index) => (
        <NoteTableRow
          key={note._id}
          itemNumber={index + 1}
          note={note}
          onChanged={onChanged}
        />
      ))}
    </TableBody>
  );
};

export default NoteTableBody;
