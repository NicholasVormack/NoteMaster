import React from 'react';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import TableCell from '@material-ui/core/TableCell';

const NoteTableHeader = ({ names }) => (
  <TableHead>
    <TableRow>
      {names.map((text, index) => (
        <TableCell key={`${text}-${index}`} align="left">
          {text}
        </TableCell>
      ))}
    </TableRow>
  </TableHead>
);

export default NoteTableHeader;
