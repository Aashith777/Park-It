import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Landing() {
  const { session, profile } = useAuth();

  const primaryLink = !session
    ? "/register"
    : profile?.role === "owner"
    ? "/owner/dashboard"
    : "/search";

  return (
    <div>
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-5 pt-20 pb-16 grid md:grid-cols-2 gap-10 items-center">
        <div>
          <span className="inline-block text-xs font-semibold tracking-widest uppercase text-signal mb-4">
            Park ahead, not around
          </span>
          <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight text-ink mb-5">
            Reserve your parking spot before you even leave home.
          </h1>
          <p className="text-asphalt/70 text-lg mb-8 max-w-md">
            Find a spot near your destination, pay with UPI in seconds, and get
            turn-by-turn navigation straight to it. No spot found on arrival, no
            circling the block, no wasted fuel.
          </p>
          <div className="flex gap-3">
            <Link
              to={primaryLink}
              className="bg-signal text-white px-6 py-3 rounded-full font-medium hover:bg-signal/90 transition"
            >
              {session ? "Go to app" : "Find a parking spot"}
            </Link>
            <a
              href="#how"
              className="border border-ink/15 px-6 py-3 rounded-full font-medium hover:bg-mist transition"
            >
              How it works
            </a>
          </div>
        </div>

        <div className="bg-ink rounded-3xl p-8 text-white">
          <div className="flex justify-between text-xs text-white/50 mb-6">
            <span>LIVE SLOT</span>
            <span>MG Road Parking Plaza</span>
          </div>
          <div className="font-display text-5xl font-bold mb-1">B-14</div>
          <p className="text-white/60 text-sm mb-6">Reserved for 2 hours · ₹60 total</p>
          <div className="h-px bg-white/10 mb-6" />
          <div className="flex justify-between text-sm">
            <span className="text-white/60">Arrive within</span>
            <span className="font-semibold text-signal">15:00 min</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-white py-20">
        <div className="max-w-6xl mx-auto px-5">
          <h2 className="font-display text-2xl font-bold text-center mb-12">How ParkSmart works</h2>
          <div className="grid md:grid-cols-4 gap-8 text-sm">
            {[
              ["Search nearby", "We use your live location to show parking areas close to your destination."],
              ["Book & pay", "Pick a duration and pay instantly with UPI, cards, or netbanking."],
              ["Navigate there", "One tap opens Google Maps directions straight to the spot."],
              ["Auto-released if late", "Miss your arrival window and the slot frees up automatically — no wasted space."],
            ].map(([title, desc], i) => (
              <div key={title}>
                <div className="w-8 h-8 rounded-full bg-signal/10 text-signal font-display font-bold flex items-center justify-center mb-3">
                  {i + 1}
                </div>
                <h3 className="font-semibold text-ink mb-1">{title}</h3>
                <p className="text-asphalt/60">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Owner CTA */}
      <section className="py-20 text-center">
        <h2 className="font-display text-2xl font-bold mb-3">Own a parking lot?</h2>
        <p className="text-asphalt/70 mb-6">
          List your space, track bookings in real time, and see your revenue grow.
        </p>
        <Link
          to={session ? "/owner/add-parking" : "/register?role=owner"}
          className="inline-block border border-ink/20 px-6 py-3 rounded-full font-medium hover:bg-white transition"
        >
          List your parking area
        </Link>
      </section>
    </div>
  );
}
