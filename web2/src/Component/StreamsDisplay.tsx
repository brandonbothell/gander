import { Splitter } from '@mantine/core'
import { type Stream } from '../../../source/types/shared'
import StreamVideo from './StreamVideo'

export default function StreamsDisplay(props: { streams: Stream[] }) {
  if (!props.streams || props.streams.length === 0) {
    return <div>No streams available</div>
  }

  return (
    <Splitter h={'80vh'} w={'60vw'}>
      <Splitter.Pane defaultSize={50} min={30} display={'initial'}>
        <Splitter orientation="vertical" h="100%">
          <Splitter.Pane defaultSize={50} min={20} bg="blue">
            <StreamVideo streamId={props.streams[0].id} />
          </Splitter.Pane>
          <Splitter.Pane defaultSize={50} min={20} bg="violet">
            Terminal
          </Splitter.Pane>
        </Splitter>
      </Splitter.Pane>
      <Splitter.Pane defaultSize={50} min={30} display={'initial'}>
        <Splitter orientation="vertical" h="100%">
          <Splitter.Pane defaultSize={50} min={20} bg="teal">
            Editor
          </Splitter.Pane>
          <Splitter.Pane defaultSize={50} min={20} bg="grape">
            Terminal
          </Splitter.Pane>
        </Splitter>
      </Splitter.Pane>
    </Splitter>
  )
}
