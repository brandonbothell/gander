import { createStreamManager, prisma } from '../camera';
import { jwtAuth } from '../middleware/jwtAuth';
import { StreamManager } from '../streamManager';
import express from 'express';

export default function initializeStreamRoutes(
  app: express.Application,
  dynamicStreams: Record<string, StreamManager>,
) {
  // List all streams
  app.get('/api/streams', jwtAuth, async (req, res) => {
    const streams = await prisma.stream.findMany();
    res.json(streams);
  });

  // Create a new stream
  app.post('/api/streams', jwtAuth, express.json(), async (req, res) => {
    const { nickname, ffmpegInput, rtspUser, rtspPass } = req.body;
    const count = await prisma.stream.count();
    if (count >= 4) {
      res.status(400).json({ error: 'Maximum of 4 streams allowed.' });
      return;
    }
    if (!nickname || !ffmpegInput) {
      res.status(400).json({ error: 'Nickname and ffmpegInput are required.' });
      return;
    }
    const validation = validateStreamInput({ ffmpegInput, rtspUser, rtspPass });
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }
    console.log(
      `[POST] Creating new stream with nickname: ${nickname}, ffmpegInput: ${ffmpegInput}, rtspUser: ${rtspUser}, rtspPass: ${rtspPass}`,
    );
    try {
      const stream = await prisma.stream.create({
        data: { nickname, ffmpegInput, rtspUser, rtspPass },
      });
      try {
        dynamicStreams[stream.id] = await createStreamManager(stream);
        await dynamicStreams[stream.id].startFFmpeg().catch((err) => {
          console.warn(
            `[${stream.id}] FFmpeg failed to start:`,
            err?.message || err,
          );
        });
      } catch (err) {
        console.error(
          `[StreamManager] Failed to start FFmpeg for stream ${stream.id}:`,
          err,
        );
        res
          .status(500)
          .json({ error: 'Failed to start FFmpeg for new stream.' });
        return;
      }
      res.status(201).json(stream);
    } catch (e) {
      console.error(`[StreamManager] Failed to create stream:`, e);
      res.status(500).json({ error: 'Failed to create stream.' });
    }
  });

  // Update a stream
  app.patch('/api/streams/:id', jwtAuth, express.json(), async (req, res) => {
    const { id } = req.params;
    const { nickname, ffmpegInput, rtspUser, rtspPass } = req.body;
    const stream = await prisma.stream.findUnique({ where: { id } });
    if (!stream) {
      res.status(404).json({ error: 'Stream not found.' });
      return;
    }
    const validation = validateStreamInput({
      ffmpegInput: ffmpegInput ?? stream.ffmpegInput,
      rtspUser: rtspUser ?? stream.rtspUser,
      rtspPass: rtspPass ?? stream.rtspPass,
    });
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }
    console.log(
      `[PATCH] Updating stream ${id} with nickname: ${nickname}, ffmpegInput: ${ffmpegInput}, rtspUser: ${rtspUser}, rtspPass: ${rtspPass}`,
    );
    try {
      const updated = await prisma.stream.update({
        where: { id },
        data: Object.fromEntries(
          Object.entries({ nickname, ffmpegInput, rtspUser, rtspPass }).filter(
            ([_, v]) => v !== undefined,
          ),
        ),
      });

      // Only restart ffmpeg if ffmpegInput, rtspUser, or rtspPass changed
      const shouldRestart =
        (ffmpegInput !== undefined && ffmpegInput !== stream.ffmpegInput) ||
        (rtspUser !== undefined && rtspUser !== stream.rtspUser) ||
        (rtspPass !== undefined && rtspPass !== stream.rtspPass);

      if (dynamicStreams[id] && shouldRestart) {
        try {
          dynamicStreams[id].destroy();
          dynamicStreams[id] = await createStreamManager(updated);
          await dynamicStreams[id].startFFmpeg().catch((err) => {
            console.warn(
              `[${dynamicStreams[id].config.id}] FFmpeg failed to start:`,
              err?.message || err,
            );
          });
        } catch (err) {
          console.error(
            `[StreamManager] Failed to restart FFmpeg for stream ${id}:`,
            err,
          );
          res
            .status(500)
            .json({ error: 'Failed to restart FFmpeg for updated stream.' });
          return;
        }
      }
      res.json(updated);
    } catch (e) {
      console.error(`[StreamManager] Failed to update stream:`, e);
      res.status(500).json({ error: 'Failed to update stream.' });
    }
  });

  // Reconnect a stream (restart FFmpeg, clear state, restart monitoring)
  app.post('/api/streams/:id/reconnect', jwtAuth, async (req, res) => {
    const { id } = req.params;
    const stream = dynamicStreams[id];
    if (!stream) {
      res.status(404).json({ error: 'Stream not found.' });
      return;
    }
    try {
      await stream.reconnect();
      res.json({ success: true });
    } catch (_) {
      res.status(500).json({ error: 'Failed to reconnect stream.' });
    }
  });

  // Delete a stream
  app.delete('/api/streams/:id', jwtAuth, async (req, res) => {
    const { id } = req.params;
    const stream = await prisma.stream.findUnique({ where: { id } });
    if (!stream) {
      res.status(404).json({ error: 'Stream not found.' });
      return;
    }
    try {
      await prisma.stream.delete({ where: { id } });
      if (dynamicStreams[id]) {
        try {
          dynamicStreams[id].destroy();
        } catch (err) {
          console.error(`[StreamManager] Failed to destroy stream ${id}:`, err);
          res.status(500).json({ error: 'Failed to destroy stream.' });
          return;
        }
        delete dynamicStreams[id];
      }
      res.json({ success: true });
    } catch (e) {
      console.error(`[StreamManager] Failed to delete stream:`, e);
      res.status(500).json({ error: 'Failed to delete stream.' });
    }
  });
}

// Helper: Validate ffmpegInput and credentials
function validateStreamInput({
  ffmpegInput,
  rtspUser,
  rtspPass,
}: {
  ffmpegInput: string;
  rtspUser?: string;
  rtspPass?: string;
}) {
  // Only allow RTSP URLs or DirectShow device strings
  const isRtsp = /^rtsp:\/\//i.test(ffmpegInput);
  const isDirectShow = /^video=.+:audio=.+/i.test(ffmpegInput);
  if (!isRtsp && !isDirectShow) {
    return {
      valid: false,
      error:
        'ffmpegInput must be an RTSP URL or DirectShow device string (video=...:audio=...)',
    };
  }
  if (isRtsp && ((rtspUser && !rtspPass) || (!rtspUser && rtspPass))) {
    return {
      valid: false,
      error: 'Both rtspUser and rtspPass must be provided for RTSP streams.',
    };
  }
  return { valid: true };
}
