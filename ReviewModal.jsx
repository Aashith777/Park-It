import { useState } from "react";
import { supabase } from "../api/supabaseClient";
import { useAuth } from "../context/AuthContext";
import StarRating from "./StarRating";

export default function ReviewModal({ booking, onClose, onSubmitted }) {
  const { session } = useAuth();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase.from("reviews").insert({
      booking_id: booking.id,
      user_id: session.user.id,
      parking_area_id: booking.parking_area_id,
      rating,
      comment: comment.trim() || null,
    });
    setLoading(false);
    if (error) setError(error.message);
    else onSubmitted();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
        <h3 className="font-display font-semibold text-lg mb-1">How was it?</h3>
        <p className="text-sm text-asphalt/60 mb-4">{booking.parking_areas?.name}</p>

        <div className="flex justify-center mb-4">
          <StarRating value={rating} onChange={setRating} size={32} />
        </div>

        <textarea
          placeholder="Add a comment (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          className="w-full border border-ink/15 rounded-lg px-3 py-2 mb-4 text-sm"
        />

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 border border-ink/15 rounded-full py-2 text-sm font-medium hover:bg-mist"
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 bg-signal text-white rounded-full py-2 text-sm font-medium hover:bg-signal/90 disabled:opacity-50"
          >
            {loading ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
