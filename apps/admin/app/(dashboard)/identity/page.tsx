import type { Metadata } from 'next'
import { PageHeader } from '../../../components/shell/PageHeader'
import { IdentityEditor } from '../../../components/identity/IdentityEditor'
import { SocialLinksEditor } from '../../../components/identity/SocialLinksEditor'
import { readSocialLinks } from '../../../lib/data/socialLinks'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'
import { adminData } from '../../../lib/adminData'
import { pageWithAccess } from '../../../lib/access/instance'

export const metadata: Metadata = { title: 'هوية المتجر' }

export default pageWithAccess('zell.identity.view', async function IdentityPage(_ctx) {
  const [identity, social] = await Promise.all([adminData.getIdentity(), readSocialLinks()])

  return (
    <>
      <PageHeader title="هوية المتجر" description="اللوجو والاسم وبيانات التواصل والسوشيال ميديا" />
      <div className="mb-4">
        <PreviewNotice what="تعديل اللوجو وبيانات المتجر" />
      </div>
      <IdentityEditor identity={identity} />
      <div className="mt-4">
        <SocialLinksEditor initial={social} />
      </div>
    </>
  )
})
