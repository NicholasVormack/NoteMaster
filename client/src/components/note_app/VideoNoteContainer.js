import React, { useState } from 'react';
import { Grid } from '@material-ui/core';
import VideoContainer from './VideoContainer';
import NoteContainer from './NoteContainer';
import { withRouter } from 'react-router-dom';

const VideoNoteContainer = (props) => {
  const [videoLink, setVideoLink] = useState("");
  const [note, setNote] = useState(null);
  const videoRef = React.createRef();

  let urlBase = '/api/notes/';

  const save = async (note) => {
    const { id, title, body, author, type, tags } = note;
    
    let url = urlBase;
    if(type === 'PUT') {
      url += id;
    }

    // A note does not have to be attached to a video: the player is often not
    // ready yet, and was never loaded at all for a plain note. Awaiting
    // getCurrentTime() unconditionally threw before, so Save silently did
    // nothing. A missing position falls back to 0.
    let time = 0;
    try {
      const player = videoRef.current && videoRef.current.internalPlayer;
      if(player) time = (await player.getCurrentTime()) || 0;
    } catch(error) {
      time = 0;
    }

    let reqBody = JSON.stringify({
      title: title,
      body: body,
      author: author,
      tags: tags,
      videoLink: videoLink,
      videoTimestamp: time
    });

    try {
      const response = await fetch(url, {
        method: type,
        headers: {
          'content-type': 'application/json',
          'x-auth-token': localStorage.getItem('token')
        },
        body: reqBody
      });

      const json = await response.json();

      if(!response.ok) {
        window.alert(json.msg || 'Could not save that note.');
        return;
      }

      setNote(json);

      // Land on the list so the saved note, its tags and its pin control are
      // visible immediately instead of leaving the user on a stale editor.
      props.history.push('/home');
    } catch(error) {
      window.alert('Could not reach the server. Your note was not saved.');
    }
  }

  return (
    <>
      <Grid 
        container 
        direction='row' 
        justify='space-around' 
        alignItems='center' 
        style={{maxHeight: '100%', height: '100%', padding: '10px'}}>
          <VideoContainer videoRef={videoRef} setVideoLink={setVideoLink} {...props}/>
          <NoteContainer note={note} {...props} handleSave={(note) => save(note)}/>
      </Grid>
    </>
  )

}

export default withRouter(VideoNoteContainer);