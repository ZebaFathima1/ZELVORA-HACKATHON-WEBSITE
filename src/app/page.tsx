import Link from "next/link";
import { ArrowRight, BookOpen, BriefcaseBusiness, HeartPulse, Lightbulb } from "lucide-react";
import { ThemeToggle } from "@/app/theme-toggle";

const tracks = [
  { title: "Education / EdTech", detail: "Build more accessible, engaging learning experiences.", icon: BookOpen },
  { title: "AI Innovation", detail: "Put thoughtful, useful artificial intelligence to work.", icon: Lightbulb },
  { title: "Healthcare", detail: "Reimagine care with safe, people-first technology.", icon: HeartPulse },
  { title: "Business", detail: "Create practical products for real market needs.", icon: BriefcaseBusiness }
];

export default function HomePage() {
  return (
    <>
      <header className="topbar">
        <div className="container nav-inner">
          <Link className="brand" href="/">
            <span className="brand-mark">Z</span>
            <span>ZELVORA<small>TECHNOLOGIES PVT. LTD.</small></span>
          </Link>
          <nav className="nav-links" aria-label="Main navigation">
            <a href="#tracks">Tracks</a>
            <a href="#process">How it works</a>
            <ThemeToggle />
            <Link href="/submit" className="button small">Submit project <ArrowRight size={14} /></Link>
          </nav>
        </div>
      </header>
      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <span className="eyebrow">Zelvora Hackathon · Project portal</span>
              <h1>Build what<br />moves <span>tomorrow.</span></h1>
              <p className="hero-copy">A home for ambitious ideas and the teams bringing them to life. Submit your final project, share your evidence, and let your work speak for itself.</p>
              <div className="hero-actions">
                <Link href="/submit" className="button">Start your submission <ArrowRight size={16} /></Link>
                <a href="#tracks" className="button secondary">Explore the tracks</a>
              </div>
            </div>
            <aside className="hero-card" aria-label="Hackathon tracks">
              <div className="hero-card-head"><strong>Four tracks. One big idea.</strong><span className="live-pill">Project portal</span></div>
              {tracks.map((track, index) => (
                <div className="track-line" key={track.title}><span><strong>0{index + 1}</strong>&nbsp;&nbsp; {track.title}</span><track.icon size={16} /></div>
              ))}
            </aside>
          </div>
        </section>
        <section className="section" id="tracks">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">Choose your challenge</span>
              <h2>Ideas that make a difference.</h2>
              <p>Your team’s track is assigned during registration. The submission portal will display the registered track and team details for confirmation.</p>
            </div>
            <div className="track-grid">
              {tracks.map((track, index) => (
                <article className="track-card" key={track.title}>
                  <span className="track-number">TRACK 0{index + 1}</span>
                  <h3>{track.title}</h3>
                  <p>{track.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="section steps-section" id="process">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">Your final mile</span>
              <h2>From team ID to submitted.</h2>
              <p>One submission per registered team. Make it count with a clear story and the work to back it up.</p>
            </div>
            <div className="steps-grid">
              {[
                ["01", "Verify your team", "Use the Team ID from registration. Your team profile and assigned track are read-only."],
                ["02", "Tell the whole story", "Share your problem, solution, implementation, repository, and project presentation."],
                ["03", "Review and submit", "Check every detail carefully. Once submitted, your project cannot be edited or replaced."]
              ].map(([number, title, description]) => (
                <article className="step-card" key={number}><span>{number}</span><h3>{title}</h3><p>{description}</p></article>
              ))}
            </div>
          </div>
        </section>
        <section className="section">
          <div className="container" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 25, flexWrap: "wrap" }}>
            <div className="section-heading" style={{ margin: 0 }}>
              <span className="eyebrow">Ready when you are</span>
              <h2>Give your idea its moment.</h2>
              <p>Have your team ID and project materials ready before you begin.</p>
            </div>
            <Link href="/submit" className="button">Continue to submissions <ArrowRight size={16} /></Link>
          </div>
        </section>
      </main>
      <footer className="footer"><div className="container footer-inner"><span>© {new Date().getFullYear()} Zelvora Technologies Pvt. Ltd.</span><span>Hackathon submission &amp; evaluation platform</span></div></footer>
    </>
  );
}
