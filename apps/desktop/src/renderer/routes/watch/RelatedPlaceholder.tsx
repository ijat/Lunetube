import { MessageSquare, ListVideo } from 'lucide-react';

/**
 * Direction B is a single immersive column — there is no right-hand related
 * rail (`.stage[data-dir="b"] .rail { display: none }` in the mockup). Comments
 * and "up next" therefore stack under the description. Both are explicit
 * "arriving in Phase 2" placeholders rather than silent gaps (plan P1-6):
 * threaded comments and the related feed land with the rest of Phase 2
 * (`yt:comments` / `yt:related` are already wired at the adapter).
 */
export function RelatedPlaceholder() {
  return (
    <div className="watch__phase2">
      <section className="watch__ph" aria-labelledby="watch-ph-comments">
        <h2 id="watch-ph-comments" className="watch__ph-title">
          <MessageSquare size={16} strokeWidth={1.8} aria-hidden="true" />
          Comments
        </h2>
        <p className="watch__ph-note">
          Threaded comments with replies and clickable timestamps arrive in Phase 2.
        </p>
      </section>

      <section className="watch__ph" aria-labelledby="watch-ph-related">
        <h2 id="watch-ph-related" className="watch__ph-title">
          <ListVideo size={16} strokeWidth={1.8} aria-hidden="true" />
          Up next
        </h2>
        <p className="watch__ph-note">Related videos and autoplay arrive in Phase 2.</p>
      </section>
    </div>
  );
}
