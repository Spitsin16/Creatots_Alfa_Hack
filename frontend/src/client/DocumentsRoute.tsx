import { useSession } from '../auth'
import { DocumentsPage } from '../common/Documents'

export function DocumentsRoute() {
  const { token, me } = useSession()
  const business = me.businesses[0]
  return <DocumentsPage token={token} businessId={business.id} businessName={business.name} canUpload={business.permissions.includes('FILL')} />
}
