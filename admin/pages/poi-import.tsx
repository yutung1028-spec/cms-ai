import { useState, type ChangeEvent } from 'react'
import { gql, useMutation } from '@keystone-6/core/admin-ui/apollo'
import { PageContainer } from '@keystone-6/core/admin-ui/components'
import { Button } from '@keystar/ui/button'
import { Box, VStack } from '@keystar/ui/layout'
import { Heading, Text } from '@keystar/ui/typography'
import {
  MAX_POI_IMPORT_BYTES,
  parsePoiImportJson,
  type PoiImportParseResult,
} from '../../poi-import/validate.ts'

const IMPORT_POIS = gql`
  mutation ImportPois($payload: String!) {
    importPois(payload: $payload) {
      ok
      error
      createdOccupantCount
      createdAmenityCount
      items {
        index
        type
        id
      }
    }
  }
`

type ImportPoisMutation = {
  importPois: {
    ok: boolean
    error: string | null
    createdOccupantCount: number
    createdAmenityCount: number
    items: { index: number; type: string; id: string }[]
  }
}

function formatLnglat(value: { lng: number; lat: number } | null): string {
  if (!value) return ''
  return `${value.lng}, ${value.lat}`
}

export default function PoiImportPage() {
  const [fileName, setFileName] = useState('')
  const [payload, setPayload] = useState<string | null>(null)
  const [preview, setPreview] = useState<PoiImportParseResult | null>(null)
  const [result, setResult] = useState<ImportPoisMutation['importPois'] | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)
  const [importPois, { loading }] = useMutation<ImportPoisMutation>(IMPORT_POIS)

  function resetFileState() {
    setPayload(null)
    setPreview(null)
    setResult(null)
    setClientError(null)
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    resetFileState()
    setFileName(file?.name ?? '')
    if (!file) return

    if (file.size > MAX_POI_IMPORT_BYTES) {
      setClientError(`File must be at most ${MAX_POI_IMPORT_BYTES} bytes`)
      return
    }

    const text = await file.text()
    setPayload(text)
    setPreview(parsePoiImportJson(text))
  }

  async function onImport() {
    if (!payload || !preview?.ok || loading) return
    try {
      const response = await importPois({ variables: { payload } })
      setResult(response.data?.importPois ?? null)
    } catch {
      setClientError('Import failed')
    }
  }

  const canImport = Boolean(preview?.ok && payload && !loading)
  const summary = preview?.summary

  return (
    <PageContainer header={<Heading type="h3">POI Import</Heading>} title="POI Import">
      <VStack gap="large" paddingY="large">
        <Text>
          Choose a JSON file to preview. Nothing is written until you confirm Import. Re-importing
          the same file may create duplicate records.
        </Text>
        <input type="file" accept="application/json,.json" onChange={onFileChange} />
        {fileName ? <Text>Selected file: {fileName}</Text> : null}
        {clientError ? <Text>{clientError}</Text> : null}
        {preview?.error ? <Text>{preview.error}</Text> : null}

        {summary ? (
          <VStack gap="small">
            <Text>Total: {summary.total}</Text>
            <Text>Occupants: {summary.occupant}</Text>
            <Text>Amenities: {summary.amenity}</Text>
            <Text>Valid: {summary.valid}</Text>
            <Text>Invalid: {summary.invalid}</Text>
          </VStack>
        ) : null}

        {preview?.previews.length ? (
          <Box overflow="auto">
            <table>
              <thead>
                <tr>
                  <th>Index</th>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Nickname</th>
                  <th>Address</th>
                  <th>Lnglat</th>
                  <th>Facilities</th>
                  <th>Access</th>
                  <th>Notes</th>
                  <th>Checked at</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {preview.previews.map(row => (
                  <tr key={row.index}>
                    <td>{row.index}</td>
                    <td>{row.type}</td>
                    <td>{row.name}</td>
                    <td>{row.nickname}</td>
                    <td>{row.address}</td>
                    <td>{formatLnglat(row.lnglat)}</td>
                    <td>{row.disabledFacilitiesStatus}</td>
                    <td>{row.accessibilityStatus}</td>
                    <td>{row.accessibilityNotes}</td>
                    <td>{row.accessibilityCheckedAt}</td>
                    <td>{row.errors.length ? row.errors.join('; ') : 'Valid'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        ) : null}

        {preview?.ok ? (
          <VStack gap="regular">
            <Text>
              This will create {preview.summary.occupant} Occupant record(s) and{' '}
              {preview.summary.amenity} Amenity record(s). Duplicate imports of the same file may
              create duplicate data.
            </Text>
            <Button
              prominence="high"
              isDisabled={!canImport}
              onPress={() => {
                void onImport()
              }}
            >
              {loading ? 'Importing…' : 'Import'}
            </Button>
          </VStack>
        ) : null}

        {result ? (
          <VStack gap="small">
            <Text>{result.ok ? 'Import succeeded.' : result.error ?? 'Import failed.'}</Text>
            {result.ok ? (
              <>
                <Text>Created occupants: {result.createdOccupantCount}</Text>
                <Text>Created amenities: {result.createdAmenityCount}</Text>
                {result.items.map(item => (
                  <Text key={`${item.type}-${item.id}`}>
                    {item.index}: {item.type} {item.id}
                  </Text>
                ))}
              </>
            ) : null}
          </VStack>
        ) : null}
      </VStack>
    </PageContainer>
  )
}
