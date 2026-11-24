import React, { useEffect, useMemo, useState } from 'react';
import { withRouter, Redirect } from 'react-router-dom';
import {
  Grid,
  Card,
  Fab,
  TextField,
  Select,
  MenuItem,
  FormControl,
  Typography,
} from '@material-ui/core';
import EditIcon from '@material-ui/icons/Edit';
import { useAuth } from '../auth/auth';
import useFetch from '../util/APIFetch';
import NoteTable from './NoteTable';

const SORT_OPTIONS = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'created', label: 'Recently created' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A-Z' },
];

const HomePage = (props) => {
  const { username } = useAuth();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('recent');
  const [knownTags, setKnownTags] = useState([]);

  // Debounce so typing does not fire one request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (tag) params.set('tag', tag);
    if (sort) params.set('sort', sort);
    const query = params.toString();
    return `/api/notes${query ? `?${query}` : ''}`;
  }, [debouncedSearch, tag, sort]);

  const { data, loading, error, refetch } = useFetch(url, {}, 'GET');

  // Keep every tag we have ever seen so the filter list does not shrink to the
  // current selection.
  useEffect(() => {
    if (!Array.isArray(data)) return;
    setKnownTags((previous) => {
      const merged = new Set(previous);
      data.forEach((note) => (note.tags || []).forEach((value) => merged.add(value)));
      return [...merged].sort();
    });
  }, [data]);

  const newNote = () => {
    props.history.push({ pathname: '/new' });
  };

  if (!username) {
    return <Redirect to="/login" />;
  }

  const notes = Array.isArray(data) ? data : [];
  const isFiltered = Boolean(debouncedSearch || tag);

  return (
    <Grid container style={{ width: '100%' }} direction="column" alignItems="center">
      <Grid
        item
        md={8}
        xs={10}
        component={Card}
        container
        direction="column"
        elevation={5}
        style={{ margin: '40px 0 16px', padding: '16px' }}
      >
        <Grid item xs={12}>
          <Grid container spacing={2} alignItems="center" justify="space-between">
            <Grid item xs={12} md={5}>
              <TextField
                fullWidth
                size="small"
                variant="outlined"
                placeholder="Search titles, text and tags"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Grid>

            <Grid item xs={6} md={3}>
              <FormControl fullWidth size="small" variant="outlined">
                <Select
                  value={tag}
                  displayEmpty
                  onChange={(event) => setTag(event.target.value)}
                >
                  <MenuItem value="">All tags</MenuItem>
                  {knownTags.map((value) => (
                    <MenuItem key={value} value={value}>
                      {value}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={6} md={4}>
              <FormControl fullWidth size="small" variant="outlined">
                <Select
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Grid>

        <Grid item xs={12} style={{ marginTop: '16px' }}>
          <Typography variant="caption" color="textSecondary">
            {loading
              ? 'Loading notes...'
              : `${notes.length} note${notes.length === 1 ? '' : 's'}${
                  isFiltered ? ' matching your filters' : ''
                }`}
          </Typography>

          {error ? (
            <Typography variant="body2" color="error" style={{ marginTop: '8px' }}>
              {error}
            </Typography>
          ) : null}

          {loading ? null : <NoteTable notes={notes} onChanged={refetch} />}
        </Grid>
      </Grid>

      <Grid container direction="row" item xs={10} md={8} justify="flex-end">
        <Fab color="primary" onClick={newNote} aria-label="New note">
          <EditIcon />
        </Fab>
      </Grid>
    </Grid>
  );
};

export default withRouter(HomePage);
