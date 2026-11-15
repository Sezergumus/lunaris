import { Play } from "lucide-react";
import type { SiteInfo } from "../data/load.ts";
import { STORIES, applyStory, storyAvailable } from "../state/stories.ts";
import type { Place } from "../state/scenario.ts";
import { Tip } from "../ui/Tooltip.tsx";

interface StoriesProps {
  sites: SiteInfo[];
  /** Selects scenario A the way a click on a site does. */
  onChoose: (place: Place) => void;
}

/** One-click scenarios for a first look: each sets up a comparison that tells one thing. */
export function Stories({ sites, onChoose }: StoriesProps) {
  const stories = STORIES.filter((story) => storyAvailable(story, sites));
  if (stories.length === 0) return null;
  return (
    <>
      <h2 className="section-label">Stories</h2>
      <ul>
        {stories.map((story) => (
          <li key={story.id} className="site-item">
            <Tip label={story.teaser} side="right">
              <button type="button" className="site-row story-row" onClick={() => applyStory(story, sites, onChoose)}>
                <span className="story-row__icon" aria-hidden="true">
                  <Play />
                </span>
                <span className="site-row__text">
                  <span className="site-row__title">{story.title}</span>
                </span>
              </button>
            </Tip>
          </li>
        ))}
      </ul>
    </>
  );
}
