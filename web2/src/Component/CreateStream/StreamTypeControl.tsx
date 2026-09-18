import { SegmentedControl } from '@mantine/core'
import classes from './StreamTypeControl.module.css'

export default function StreamTypeControl(props: {
  setType: React.Dispatch<React.SetStateAction<'RTSP' | 'Local'>>
  default?: 'RTSP' | 'Local'
}) {
  return (
    <SegmentedControl
      radius="xl"
      size="md"
      defaultValue={props.default}
      data={['RTSP', 'Local']}
      classNames={classes}
      onChange={props.setType}
    />
  )
}
