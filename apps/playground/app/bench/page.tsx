import { SiteFooter } from '../site-footer';
import { SiteHeader } from '../site-header';
import { Bench } from './Bench';
import '../site.css';
import './bench.css';

export const metadata = { title: 'Bench · VideoUltra' };

/** The performance bench: this device's capabilities, then load / play / scrub / export tests. */
export default function BenchPage() {
  return (
    <div className="site bench">
      <SiteHeader />
      <main id="content" className="bench-main">
        <header className="bench-intro">
          <h1>Performance bench</h1>
          <p className="bench-lead">
            Measures this device with the real VideoUltra engine: how quickly it opens a video,
            plays it, jumps around in it and exports it. Everything runs in this browser. Nothing is
            uploaded.
          </p>
        </header>
        <Bench />
      </main>
      <SiteFooter />
    </div>
  );
}
