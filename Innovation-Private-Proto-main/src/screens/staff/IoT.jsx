import { ComingSoon, Notice, PageHead } from '../../components/ui.jsx';
import * as I from '../../lib/icons.jsx';

/**
 * IoT monitoring is designed but not built: the sensor kit has not arrived.
 * This screen states that plainly and shows what is planned, so the client can
 * still see the shape of the feature during a walkthrough.
 */
export default function IoT() {
  const planned = [
    {
      icon: I.Sensor,
      title: 'Live status cards',
      body: 'One card per monitored plant showing the latest soil moisture, temperature and humidity, marked OK, Warning or Offline.',
    },
    {
      icon: I.Activity,
      title: '24-hour and 7-day charts',
      body: 'Readings arrive about every five minutes. The 7-day view averages them by hour so the trend stays readable.',
    },
    {
      icon: I.Alert,
      title: 'Alerts a ranger resolves',
      body: 'When a reading leaves the safe range the API opens an alert and notifies the rangers. At most one open alert per sensor and reading type.',
    },
    {
      icon: I.Settings,
      title: 'Sensor set-up by botanists',
      body: 'Link a sensor to a plant, set the safe ranges agreed with the botanists, and issue the device key that authenticates its readings.',
    },
  ];

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1000 }}>
        <PageHead
          title="IoT plant monitoring"
          sub="Soil moisture, temperature and humidity on selected plants, with alerts when a reading leaves its safe range."
        >
          <span className="badge badge-warn"><span className="dot" />Not built yet</span>
        </PageHead>

        <div style={{ marginBottom: 22 }}>
          <ComingSoon icon={I.Sensor} title="Coming soon" note="Waiting on the sensor kit">
            The ESP32 nodes and the soil-moisture and DHT22 sensors have not arrived, so there is nothing
            real to show here yet. The database tables, the readings endpoint and the device-key check are
            already in the schema, so this dashboard can be built without changing anything else.
          </ComingSoon>
        </div>

        <h2 style={{ fontSize: '1.05rem', marginBottom: 4 }}>What will go here</h2>
        <div className="small mute" style={{ marginBottom: 16 }}>
          From the release plan: items 15, 23, 24 and 27.
        </div>

        <div className="grid grid-2" style={{ marginBottom: 22 }}>
          {planned.map((p) => (
            <div className="card card-pad" key={p.title}>
              <span className="avatar" style={{ marginBottom: 10 }}><p.icon style={{ width: 16, height: 16 }} /></span>
              <h3 style={{ marginBottom: 5 }}>{p.title}</h3>
              <div className="small mute">{p.body}</div>
            </div>
          ))}
        </div>

        <Notice kind="plain" title="How it will be built">
          A simulator script posts readings to the same API the real nodes will use, so the dashboard can be
          finished and tested before any hardware is connected. One real sensor is planned for the final weeks
          if time allows.
        </Notice>
      </div>
    </div>
  );
}
