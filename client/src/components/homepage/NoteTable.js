import React from 'react';
import Table from '@material-ui/core/Table';
import NoteTableBody from './NoteTableBody';
import NoteTableHeader from './NoteTableHeader';

const NoteTable = ({ notes, onChanged }) => (
  <Table size="small">
    <NoteTableHeader names={['#', 'Title', 'Tags', 'Updated', 'Pin', '']} />
    <NoteTableBody notes={notes} onChanged={onChanged} />
  </Table>
);

export default NoteTable;
