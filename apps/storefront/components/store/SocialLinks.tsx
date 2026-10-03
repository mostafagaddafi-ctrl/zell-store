import { SOCIAL_LABELS, type SocialLink } from '@zell/core'
import { SocialIcon } from './SocialIcon'

/** أيقونات السوشيال — دواير ٤٤px عشان الصباع يدوس بسهولة على الموبايل. */
export function SocialLinks({ links }: { links: SocialLink[] }) {
  if (links.length === 0) return null

  return (
    <ul className="flex flex-wrap gap-2">
      {links.map((link) => (
        <li key={link.platform}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={SOCIAL_LABELS[link.platform]}
            title={SOCIAL_LABELS[link.platform]}
            className="grid h-11 w-11 place-items-center rounded-full border border-border bg-bg text-fg transition-colors hover:border-brand hover:bg-brand hover:text-brand-fg"
          >
            <SocialIcon platform={link.platform} className="h-5 w-5" />
          </a>
        </li>
      ))}
    </ul>
  )
}
